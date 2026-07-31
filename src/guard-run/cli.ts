import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBackendLaunchPlan } from "./buildLaunchPlan.js";
import { computeNprocCeiling, countProcessListLines } from "./headroom.js";
import { parseGuardRunArguments } from "./parseArguments.js";
import { selectGuardRunBackend } from "./selectBackend.js";
import { BackendLaunchPlan, GuardRunBackend } from "./types.js";

const JOB_OBJECT_SHIM_FILENAME = "guard-run-job-object.ps1";

function fail(message: string): never {
  process.stderr.write(`guard-run: ${message}\n`);
  process.exit(2);
}

function commandSucceeds(executable: string, args: string[]): boolean {
  const probe = spawnSync(executable, args, { stdio: "ignore", timeout: 10_000 });
  return probe.error === undefined && probe.status === 0;
}

function probedSystemdUserManagerState(): string | null {
  const probe = spawnSync("systemctl", ["--user", "is-system-running"], {
    encoding: "utf-8",
    timeout: 10_000,
  });
  if (probe.error !== undefined || typeof probe.stdout !== "string") return null;
  return probe.stdout.trim();
}

function resolveJobObjectShimPath(): string {
  const bundledSibling = join(dirname(fileURLToPath(import.meta.url)), JOB_OBJECT_SHIM_FILENAME);
  if (existsSync(bundledSibling)) return bundledSibling;
  // Dev fallback: running from src/guard-run/ via tsx, the shim only exists in
  // the plugin tree.
  const pluginTreePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "plugin",
    "scripts",
    JOB_OBJECT_SHIM_FILENAME,
  );
  if (existsSync(pluginTreePath)) return pluginTreePath;
  return fail(`cannot locate ${JOB_OBJECT_SHIM_FILENAME}; refusing to run the command unguarded`);
}

function windowsCommandNeedsCmdShell(firstCommandToken: string): boolean {
  const knownExtension = extname(firstCommandToken).toLowerCase();
  if (knownExtension === ".cmd" || knownExtension === ".bat") return true;
  if (knownExtension !== "") return false;
  const lookup = spawnSync("where.exe", [firstCommandToken], {
    encoding: "utf-8",
    timeout: 10_000,
  });
  if (lookup.error !== undefined || lookup.status !== 0) return false;
  const resolvedExtension = extname(lookup.stdout.split(/\r?\n/)[0] ?? "").toLowerCase();
  return resolvedExtension === ".cmd" || resolvedExtension === ".bat";
}

function currentUserProcessCount(): number {
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "";
  const listing = spawnSync("ps", ["-u", uid, "-o", "pid="], {
    encoding: "utf-8",
    timeout: 10_000,
  });
  if (listing.error !== undefined || listing.status !== 0) {
    return fail("cannot count current user processes for the nproc ceiling");
  }
  return countProcessListLines(listing.stdout);
}

function registerTreeCleanup(plan: BackendLaunchPlan, childPid: number | undefined): void {
  if (!plan.killsProcessGroupOnExit && plan.stopsScopeUnitOnExit === null) return;
  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (plan.killsProcessGroupOnExit && childPid !== undefined) {
      try {
        process.kill(-childPid, "SIGKILL");
      } catch {
        /* group already gone */
      }
    }
    if (plan.stopsScopeUnitOnExit !== null) {
      spawnSync("systemctl", ["--user", "stop", plan.stopsScopeUnitOnExit], {
        stdio: "ignore",
        timeout: 10_000,
      });
    }
  };
  process.on("exit", cleanup);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      cleanup();
      process.exit(128 + (signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 1));
    });
  }
}

const parseResult = parseGuardRunArguments(process.argv.slice(2));
if (parseResult.options === null) fail(parseResult.errorMessage ?? "invalid arguments");
const options = parseResult.options;

const isLinux = process.platform === "linux";
const selection = selectGuardRunBackend({
  platform: process.platform,
  hasSystemdRun: isLinux && commandSucceeds("systemd-run", ["--version"]),
  systemdUserManagerState: isLinux ? probedSystemdUserManagerState() : null,
  hasPrlimit: isLinux && commandSucceeds("prlimit", ["--version"]),
});
if (selection.backend === null) fail(selection.errorMessage ?? "no backend");
const backend = selection.backend;

const needsNprocCeiling =
  backend === GuardRunBackend.LinuxPrlimitProcessGroup ||
  backend === GuardRunBackend.DarwinUlimitProcessGroup;
const plan = buildBackendLaunchPlan({
  backend: backend,
  options: options,
  jobObjectShimPath:
    backend === GuardRunBackend.WindowsJobObject ? resolveJobObjectShimPath() : undefined,
  launcherPid: process.pid,
  commandNeedsCmdShell:
    backend === GuardRunBackend.WindowsJobObject
      ? windowsCommandNeedsCmdShell(options.command[0])
      : false,
  scopeUnitName: `muggle-guard-${process.pid}-${Date.now()}.scope`,
  nprocCeiling: needsNprocCeiling
    ? computeNprocCeiling({
        currentUserProcessCount: currentUserProcessCount(),
        activeProcessLimit: options.activeProcessLimit,
      })
    : undefined,
});

const child = spawn(plan.executable, plan.args, {
  stdio: "inherit",
  detached: plan.spawnDetached,
  windowsHide: true,
});
child.on("error", (error) => fail(`failed to launch backend: ${String(error)}`));
registerTreeCleanup(plan, child.pid);
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGKILL" ? 137 : signal === "SIGTERM" ? 143 : 1);
});
