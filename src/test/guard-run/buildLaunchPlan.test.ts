import { describe, it, expect } from "vitest";
import {
  buildBackendLaunchPlan,
  buildWindowsCommandLine,
} from "../../guard-run/buildLaunchPlan.js";
import { GuardRunBackend, GuardRunOptions } from "../../guard-run/types.js";

function optionsWith(overrides: Partial<GuardRunOptions>): GuardRunOptions {
  return {
    activeProcessLimit: 64,
    isServiceMode: false,
    command: ["node", "app.js"],
    ...overrides,
  };
}

describe("buildWindowsCommandLine", () => {
  it("leaves simple arguments bare", () => {
    expect(buildWindowsCommandLine(["node", "app.js"])).toBe("node app.js");
  });

  it("quotes arguments with spaces", () => {
    expect(buildWindowsCommandLine(["node", "my app.js"])).toBe('node "my app.js"');
  });

  it("escapes embedded quotes", () => {
    expect(buildWindowsCommandLine(["echo", 'say "hi"'])).toBe('echo "say \\"hi\\""');
  });

  it("doubles backslashes that precede a quote or the closing quote", () => {
    expect(buildWindowsCommandLine(["echo", 'dir\\"x'])).toBe('echo "dir\\\\\\"x"');
    expect(buildWindowsCommandLine(["echo", "trailing slash\\"])).toBe('echo "trailing slash\\\\"');
  });

  it("keeps backslashes not before a quote as-is", () => {
    expect(buildWindowsCommandLine(["type", "C:\\some dir\\file.txt"])).toBe(
      'type "C:\\some dir\\file.txt"',
    );
  });

  it("quotes empty arguments", () => {
    expect(buildWindowsCommandLine(["echo", ""])).toBe('echo ""');
  });
});

describe("buildBackendLaunchPlan — windows job object", () => {
  it("hands the shim limit, kill mode, launcher pid, and a base64 command line", () => {
    const plan = buildBackendLaunchPlan({
      backend: GuardRunBackend.WindowsJobObject,
      options: optionsWith({ activeProcessLimit: 10 }),
      jobObjectShimPath: "C:\\plugin\\scripts\\guard-run-job-object.ps1",
      launcherPid: 4242,
      commandNeedsCmdShell: false,
    });
    expect(plan.executable).toBe("powershell.exe");
    expect(plan.args.slice(0, 6)).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\plugin\\scripts\\guard-run-job-object.ps1",
    ]);
    expect(plan.args.slice(6, 9)).toEqual(["10", "kill", "4242"]);
    expect(Buffer.from(plan.args[9], "base64").toString("utf8")).toBe("node app.js");
    expect(plan.spawnDetached).toBe(false);
    expect(plan.killsProcessGroupOnExit).toBe(false);
    expect(plan.stopsScopeUnitOnExit).toBeNull();
  });

  it("service mode runs the shim in persist mode", () => {
    const plan = buildBackendLaunchPlan({
      backend: GuardRunBackend.WindowsJobObject,
      options: optionsWith({ isServiceMode: true }),
      jobObjectShimPath: "shim.ps1",
      launcherPid: 1,
    });
    expect(plan.args).toContain("persist");
    expect(plan.args).not.toContain("kill");
  });

  it("wraps .cmd shims in cmd.exe /d /s /c", () => {
    const plan = buildBackendLaunchPlan({
      backend: GuardRunBackend.WindowsJobObject,
      options: optionsWith({ command: ["pnpm", "test"] }),
      jobObjectShimPath: "shim.ps1",
      launcherPid: 1,
      commandNeedsCmdShell: true,
    });
    expect(Buffer.from(plan.args[9], "base64").toString("utf8")).toBe(
      'cmd.exe /d /s /c "pnpm test"',
    );
  });
});

describe("buildBackendLaunchPlan — linux systemd scope", () => {
  it("caps the scope with TasksMax and stops it on launcher exit", () => {
    const plan = buildBackendLaunchPlan({
      backend: GuardRunBackend.LinuxSystemdScope,
      options: optionsWith({ activeProcessLimit: 32 }),
      scopeUnitName: "muggle-guard-9.scope",
    });
    expect(plan.executable).toBe("systemd-run");
    expect(plan.args).toEqual([
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "--unit=muggle-guard-9.scope",
      "-p",
      "TasksMax=32",
      "--",
      "node",
      "app.js",
    ]);
    expect(plan.spawnDetached).toBe(false);
    expect(plan.stopsScopeUnitOnExit).toBe("muggle-guard-9.scope");
  });

  it("service mode leaves the scope alive past the launcher", () => {
    const plan = buildBackendLaunchPlan({
      backend: GuardRunBackend.LinuxSystemdScope,
      options: optionsWith({ isServiceMode: true }),
      scopeUnitName: "muggle-guard-9.scope",
    });
    expect(plan.stopsScopeUnitOnExit).toBeNull();
  });
});

describe("buildBackendLaunchPlan — linux prlimit process group", () => {
  it("applies the nproc ceiling in a fresh process group and reaps it on exit", () => {
    const plan = buildBackendLaunchPlan({
      backend: GuardRunBackend.LinuxPrlimitProcessGroup,
      options: optionsWith({}),
      nprocCeiling: 500,
    });
    expect(plan.executable).toBe("prlimit");
    expect(plan.args).toEqual(["--nproc=500", "--", "node", "app.js"]);
    expect(plan.spawnDetached).toBe(true);
    expect(plan.killsProcessGroupOnExit).toBe(true);
  });

  it("service mode caps without the exit-time group kill", () => {
    const plan = buildBackendLaunchPlan({
      backend: GuardRunBackend.LinuxPrlimitProcessGroup,
      options: optionsWith({ isServiceMode: true }),
      nprocCeiling: 500,
    });
    expect(plan.killsProcessGroupOnExit).toBe(false);
  });
});

describe("buildBackendLaunchPlan — darwin ulimit process group", () => {
  it("sets the nproc ceiling in the child shell before exec", () => {
    const plan = buildBackendLaunchPlan({
      backend: GuardRunBackend.DarwinUlimitProcessGroup,
      options: optionsWith({ command: ["npm", "run", "dev"] }),
      nprocCeiling: 700,
    });
    expect(plan.executable).toBe("/bin/sh");
    expect(plan.args).toEqual([
      "-c",
      'ulimit -u 700; exec "$@"',
      "guard-run",
      "npm",
      "run",
      "dev",
    ]);
    expect(plan.spawnDetached).toBe(true);
    expect(plan.killsProcessGroupOnExit).toBe(true);
  });

  it("service mode caps without the exit-time group kill", () => {
    const plan = buildBackendLaunchPlan({
      backend: GuardRunBackend.DarwinUlimitProcessGroup,
      options: optionsWith({ isServiceMode: true }),
      nprocCeiling: 700,
    });
    expect(plan.killsProcessGroupOnExit).toBe(false);
  });
});

// Live smoke procedure for the POSIX backends (run on a real linux/darwin
// host; the Windows equivalent is exercised for real in CI-adjacent dev):
//
//   1. fork.js: spawns 100 children of `sleep 15`, prints spawned/failed counts.
//   2. node plugin/scripts/guard-run.mjs --limit 10 -- node fork.js
//      → expect: a handful spawn, the rest fail at creation (EAGAIN); exit 0.
//   3. node plugin/scripts/guard-run.mjs --limit 10 -- node fork.js & then
//      kill -TERM the guard-run pid mid-run
//      → expect: no fork.js or sleep survivors (`pgrep -f fork.js` empty);
//        systemd backend: `systemctl --user list-units 'muggle-guard-*'` empty.
describe.skip("posix live smoke — manual procedure above", () => {
  it("caps spawns at the limit and reaps the tree with the launcher", () => {
    /* intentionally unimplemented: real forking must not run in unit suites */
  });
});
