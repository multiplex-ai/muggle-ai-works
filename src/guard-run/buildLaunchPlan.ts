import { BackendLaunchPlan, GuardRunBackend, GuardRunOptions } from "./types.js";

function quoteWindowsArgument(argument: string): string {
  if (argument !== "" && !/[ \t"]/.test(argument)) return argument;
  let quoted = '"';
  let backslashCount = 0;
  for (const character of argument) {
    if (character === "\\") {
      backslashCount += 1;
      continue;
    }
    if (character === '"') {
      quoted += "\\".repeat(backslashCount * 2 + 1) + '"';
      backslashCount = 0;
      continue;
    }
    quoted += "\\".repeat(backslashCount) + character;
    backslashCount = 0;
  }
  return quoted + "\\".repeat(backslashCount * 2) + '"';
}

/** argv → single CreateProcessW command line, MSVCRT quoting rules. */
export function buildWindowsCommandLine(command: string[]): string {
  return command.map(quoteWindowsArgument).join(" ");
}

export interface WindowsJobObjectPlanInput {
  options: GuardRunOptions;
  jobObjectShimPath: string;
  launcherPid: number;
  /** First token resolves to a .cmd/.bat shim, which CreateProcessW cannot exec directly. */
  commandNeedsCmdShell: boolean;
}

export function buildWindowsJobObjectPlan(input: WindowsJobObjectPlanInput): BackendLaunchPlan {
  const bareCommandLine = buildWindowsCommandLine(input.options.command);
  const commandLine = input.commandNeedsCmdShell
    ? `cmd.exe /d /s /c "${bareCommandLine}"`
    : bareCommandLine;
  return {
    executable: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      input.jobObjectShimPath,
      String(input.options.activeProcessLimit),
      input.options.isServiceMode ? "persist" : "kill",
      String(input.launcherPid),
      // Base64 survives the node→powershell→CreateProcessW arg relays that
      // would otherwise re-interpret quotes.
      Buffer.from(commandLine, "utf8").toString("base64"),
    ],
    spawnDetached: false,
    killsProcessGroupOnExit: false,
    stopsScopeUnitOnExit: null,
  };
}

export function buildLinuxSystemdScopePlan(args: {
  options: GuardRunOptions;
  scopeUnitName: string;
}): BackendLaunchPlan {
  return {
    // pids.max (cgroup v2): the excess fork fails with EAGAIN in the kernel.
    executable: "systemd-run",
    args: [
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      `--unit=${args.scopeUnitName}`,
      "-p",
      `TasksMax=${args.options.activeProcessLimit}`,
      "--",
      ...args.options.command,
    ],
    spawnDetached: false,
    killsProcessGroupOnExit: false,
    // Catchable launcher death stops the scope; after an untrappable SIGKILL
    // the scope lives on but stays TasksMax-bounded, so the cap always holds.
    stopsScopeUnitOnExit: args.options.isServiceMode ? null : args.scopeUnitName,
  };
}

export function buildLinuxPrlimitProcessGroupPlan(args: {
  options: GuardRunOptions;
  nprocCeiling: number;
}): BackendLaunchPlan {
  return {
    executable: "prlimit",
    args: [`--nproc=${args.nprocCeiling}`, "--", ...args.options.command],
    spawnDetached: true,
    killsProcessGroupOnExit: !args.options.isServiceMode,
    stopsScopeUnitOnExit: null,
  };
}

export function buildDarwinUlimitProcessGroupPlan(args: {
  options: GuardRunOptions;
  nprocCeiling: number;
}): BackendLaunchPlan {
  return {
    executable: "/bin/sh",
    args: ["-c", `ulimit -u ${args.nprocCeiling}; exec "$@"`, "guard-run", ...args.options.command],
    spawnDetached: true,
    killsProcessGroupOnExit: !args.options.isServiceMode,
    stopsScopeUnitOnExit: null,
  };
}

export function buildBackendLaunchPlan(args: {
  backend: GuardRunBackend;
  options: GuardRunOptions;
  jobObjectShimPath?: string;
  launcherPid?: number;
  commandNeedsCmdShell?: boolean;
  scopeUnitName?: string;
  nprocCeiling?: number;
}): BackendLaunchPlan {
  if (args.backend === GuardRunBackend.WindowsJobObject) {
    return buildWindowsJobObjectPlan({
      options: args.options,
      jobObjectShimPath: args.jobObjectShimPath ?? "",
      launcherPid: args.launcherPid ?? 0,
      commandNeedsCmdShell: args.commandNeedsCmdShell ?? false,
    });
  }
  if (args.backend === GuardRunBackend.LinuxSystemdScope) {
    return buildLinuxSystemdScopePlan({
      options: args.options,
      scopeUnitName: args.scopeUnitName ?? "",
    });
  }
  if (args.backend === GuardRunBackend.LinuxPrlimitProcessGroup) {
    return buildLinuxPrlimitProcessGroupPlan({
      options: args.options,
      nprocCeiling: args.nprocCeiling ?? 0,
    });
  }
  return buildDarwinUlimitProcessGroupPlan({
    options: args.options,
    nprocCeiling: args.nprocCeiling ?? 0,
  });
}
