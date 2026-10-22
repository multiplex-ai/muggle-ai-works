import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { availableParallelism } from 'os';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';

// src/guard-run/cli.ts

// src/guard-run/buildLaunchPlan.ts
function quoteWindowsArgument(argument) {
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
function buildWindowsCommandLine(command) {
  return command.map(quoteWindowsArgument).join(" ");
}
function buildWindowsJobObjectPlan(input) {
  const bareCommandLine = buildWindowsCommandLine(input.options.command);
  const commandLine = input.commandNeedsCmdShell ? `cmd.exe /d /s /c "${bareCommandLine}"` : bareCommandLine;
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
      Buffer.from(commandLine, "utf8").toString("base64")
    ],
    spawnDetached: false,
    killsProcessGroupOnExit: false,
    stopsScopeUnitOnExit: null
  };
}
function buildLinuxSystemdScopePlan(args) {
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
      ...args.options.command
    ],
    spawnDetached: false,
    killsProcessGroupOnExit: false,
    // Catchable launcher death stops the scope; after an untrappable SIGKILL
    // the scope lives on but stays TasksMax-bounded, so the cap always holds.
    stopsScopeUnitOnExit: args.options.isServiceMode ? null : args.scopeUnitName
  };
}
function buildLinuxPrlimitProcessGroupPlan(args) {
  return {
    executable: "prlimit",
    args: [`--nproc=${args.nprocCeiling}`, "--", ...args.options.command],
    spawnDetached: true,
    killsProcessGroupOnExit: !args.options.isServiceMode,
    stopsScopeUnitOnExit: null
  };
}
function buildDarwinUlimitProcessGroupPlan(args) {
  return {
    executable: "/bin/sh",
    args: ["-c", `ulimit -u ${args.nprocCeiling}; exec "$@"`, "guard-run", ...args.options.command],
    spawnDetached: true,
    killsProcessGroupOnExit: !args.options.isServiceMode,
    stopsScopeUnitOnExit: null
  };
}
function buildBackendLaunchPlan(args) {
  if (args.backend === "windows-job-object" /* WindowsJobObject */) {
    return buildWindowsJobObjectPlan({
      options: args.options,
      jobObjectShimPath: args.jobObjectShimPath ?? "",
      launcherPid: args.launcherPid ?? 0,
      commandNeedsCmdShell: args.commandNeedsCmdShell ?? false
    });
  }
  if (args.backend === "linux-systemd-scope" /* LinuxSystemdScope */) {
    return buildLinuxSystemdScopePlan({
      options: args.options,
      scopeUnitName: args.scopeUnitName ?? ""
    });
  }
  if (args.backend === "linux-prlimit-process-group" /* LinuxPrlimitProcessGroup */) {
    return buildLinuxPrlimitProcessGroupPlan({
      options: args.options,
      nprocCeiling: args.nprocCeiling ?? 0
    });
  }
  return buildDarwinUlimitProcessGroupPlan({
    options: args.options,
    nprocCeiling: args.nprocCeiling ?? 0
  });
}

// src/guard-run/constants.ts
var GUARD_RUN_MIN_DEFAULT_ACTIVE_PROCESS_LIMIT = 64;
var GUARD_RUN_PROCESSES_PER_CPU = 8;
var WINDOWS_SHELL_SCRIPT_EXTENSIONS = [".cmd", ".bat"];
var GUARD_RUN_USAGE = `usage: guard-run [--limit N] [--service] -- <command...>
  Runs <command> with its whole process tree kernel-capped at N processes
  (default ${GUARD_RUN_PROCESSES_PER_CPU} per logical CPU, at least ${GUARD_RUN_MIN_DEFAULT_ACTIVE_PROCESS_LIMIT}). Default mode also ties the tree
  to the launcher: killing guard-run reaps every descendant. --service keeps
  the cap but lets the tree outlive the launcher (for dev servers).`;

// src/guard-run/headroom.ts
function computeDefaultActiveProcessLimit(logicalCpuCount) {
  return Math.max(GUARD_RUN_MIN_DEFAULT_ACTIVE_PROCESS_LIMIT, logicalCpuCount * GUARD_RUN_PROCESSES_PER_CPU);
}
function countProcessListLines(psOutput) {
  return psOutput.split("\n").filter((line) => line.trim() !== "").length;
}
function computeNprocCeiling(args) {
  return args.currentUserProcessCount + args.activeProcessLimit;
}

// src/guard-run/parseArguments.ts
function parseError(errorMessage) {
  return { options: null, errorMessage: `${errorMessage}
${GUARD_RUN_USAGE}` };
}
function parsePositiveInteger(rawValue) {
  if (rawValue === void 0 || !/^\d+$/.test(rawValue)) return null;
  const parsed = Number(rawValue);
  return parsed >= 1 ? parsed : null;
}
function parseGuardRunArguments(argv, defaultActiveProcessLimit) {
  let activeProcessLimit = defaultActiveProcessLimit;
  let isServiceMode = false;
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === "--") {
      index += 1;
      break;
    }
    if (token === "--service") {
      isServiceMode = true;
      index += 1;
      continue;
    }
    if (token === "--limit" || token.startsWith("--limit=")) {
      const rawLimit = token === "--limit" ? argv[index + 1] : token.slice("--limit=".length);
      const parsedLimit = parsePositiveInteger(rawLimit);
      if (parsedLimit === null) return parseError("--limit requires a positive integer");
      activeProcessLimit = parsedLimit;
      index += token === "--limit" ? 2 : 1;
      continue;
    }
    if (token.startsWith("--")) return parseError(`unknown flag: ${token}`);
    break;
  }
  const command = argv.slice(index);
  if (command.length === 0) return parseError("no command given");
  return {
    options: {
      activeProcessLimit,
      isServiceMode,
      command
    },
    errorMessage: null
  };
}

// src/guard-run/probeRan.ts
function probeRan(probe) {
  return probe.status !== null && typeof probe.stdout === "string";
}
function isShellScript(path) {
  return WINDOWS_SHELL_SCRIPT_EXTENSIONS.includes(extname(path).toLowerCase());
}
function windowsCommandNeedsCmdShell(args) {
  if (extname(args.firstCommandToken) !== "") return isShellScript(args.firstCommandToken);
  const launchableCandidate = (args.whereOutput ?? "").split(/\r?\n/).map((candidate) => candidate.trim()).find((candidate) => extname(candidate) !== "");
  return launchableCandidate !== void 0 && isShellScript(launchableCandidate);
}

// src/guard-run/selectBackend.ts
var SYSTEMD_USABLE_MANAGER_STATES = /* @__PURE__ */ new Set(["running", "degraded"]);
function selectGuardRunBackend(probe) {
  if (probe.platform === "win32") {
    return { backend: "windows-job-object" /* WindowsJobObject */, errorMessage: null };
  }
  if (probe.platform === "linux") {
    const managerState = (probe.systemdUserManagerState ?? "").trim();
    if (probe.hasSystemdRun && SYSTEMD_USABLE_MANAGER_STATES.has(managerState)) {
      return { backend: "linux-systemd-scope" /* LinuxSystemdScope */, errorMessage: null };
    }
    if (probe.hasPrlimit) {
      return { backend: "linux-prlimit-process-group" /* LinuxPrlimitProcessGroup */, errorMessage: null };
    }
    return {
      backend: null,
      errorMessage: "no process-cap backend available (need a systemd user manager or prlimit); refusing to run the command unguarded"
    };
  }
  if (probe.platform === "darwin") {
    return { backend: "darwin-ulimit-process-group" /* DarwinUlimitProcessGroup */, errorMessage: null };
  }
  return {
    backend: null,
    errorMessage: `unsupported platform "${probe.platform}"; refusing to run the command unguarded`
  };
}

// src/guard-run/cli.ts
var JOB_OBJECT_SHIM_FILENAME = "guard-run-job-object.ps1";
function fail(message) {
  process.stderr.write(`guard-run: ${message}
`);
  process.exit(2);
}
function commandSucceeds(executable, args) {
  const probe = spawnSync(executable, args, { stdio: "ignore", timeout: 1e4, windowsHide: true });
  return probe.error === void 0 && probe.status === 0;
}
function probedSystemdUserManagerState() {
  const probe = spawnSync("systemctl", ["--user", "is-system-running"], {
    encoding: "utf-8",
    timeout: 1e4,
    windowsHide: true
  });
  if (!probeRan(probe)) return null;
  return probe.stdout.trim();
}
function resolveJobObjectShimPath() {
  const bundledSibling = join(dirname(fileURLToPath(import.meta.url)), JOB_OBJECT_SHIM_FILENAME);
  if (existsSync(bundledSibling)) return bundledSibling;
  const pluginTreePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "plugin",
    "scripts",
    JOB_OBJECT_SHIM_FILENAME
  );
  if (existsSync(pluginTreePath)) return pluginTreePath;
  return fail(`cannot locate ${JOB_OBJECT_SHIM_FILENAME}; refusing to run the command unguarded`);
}
function whereExeOutput(firstCommandToken) {
  if (extname(firstCommandToken) !== "") return null;
  const lookup = spawnSync("where.exe", [firstCommandToken], {
    encoding: "utf-8",
    timeout: 1e4,
    windowsHide: true
  });
  return lookup.error === void 0 && lookup.status === 0 ? lookup.stdout : null;
}
function currentUserProcessCount() {
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "";
  const listing = spawnSync("ps", ["-u", uid, "-o", "pid="], {
    encoding: "utf-8",
    timeout: 1e4,
    windowsHide: true
  });
  if (!probeRan(listing) || listing.status !== 0) {
    return fail("cannot count current user processes for the nproc ceiling");
  }
  return countProcessListLines(listing.stdout);
}
function registerTreeCleanup(plan2, childPid) {
  if (!plan2.killsProcessGroupOnExit && plan2.stopsScopeUnitOnExit === null) return;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (plan2.killsProcessGroupOnExit && childPid !== void 0) {
      try {
        process.kill(-childPid, "SIGKILL");
      } catch {
      }
    }
    if (plan2.stopsScopeUnitOnExit !== null) {
      spawnSync("systemctl", ["--user", "stop", plan2.stopsScopeUnitOnExit], {
        stdio: "ignore",
        timeout: 1e4,
        windowsHide: true
      });
    }
  };
  process.on("exit", cleanup);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      cleanup();
      process.exit(128 + (signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 1));
    });
  }
}
var parseResult = parseGuardRunArguments(
  process.argv.slice(2),
  computeDefaultActiveProcessLimit(availableParallelism())
);
if (parseResult.options === null) fail(parseResult.errorMessage ?? "invalid arguments");
var options = parseResult.options;
var isLinux = process.platform === "linux";
var selection = selectGuardRunBackend({
  platform: process.platform,
  hasSystemdRun: isLinux && commandSucceeds("systemd-run", ["--version"]),
  systemdUserManagerState: isLinux ? probedSystemdUserManagerState() : null,
  hasPrlimit: isLinux && commandSucceeds("prlimit", ["--version"])
});
if (selection.backend === null) fail(selection.errorMessage ?? "no backend");
var backend = selection.backend;
var needsNprocCeiling = backend === "linux-prlimit-process-group" /* LinuxPrlimitProcessGroup */ || backend === "darwin-ulimit-process-group" /* DarwinUlimitProcessGroup */;
var plan = buildBackendLaunchPlan({
  backend,
  options,
  jobObjectShimPath: backend === "windows-job-object" /* WindowsJobObject */ ? resolveJobObjectShimPath() : void 0,
  launcherPid: process.pid,
  commandNeedsCmdShell: backend === "windows-job-object" /* WindowsJobObject */ ? windowsCommandNeedsCmdShell({
    firstCommandToken: options.command[0],
    whereOutput: whereExeOutput(options.command[0])
  }) : false,
  scopeUnitName: `muggle-guard-${process.pid}-${Date.now()}.scope`,
  nprocCeiling: needsNprocCeiling ? computeNprocCeiling({
    currentUserProcessCount: currentUserProcessCount(),
    activeProcessLimit: options.activeProcessLimit
  }) : void 0
});
var child = spawn(plan.executable, plan.args, {
  stdio: "inherit",
  detached: plan.spawnDetached,
  windowsHide: true
});
child.on("error", (error) => fail(`failed to launch backend: ${String(error)}`));
registerTreeCleanup(plan, child.pid);
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGKILL" ? 137 : signal === "SIGTERM" ? 143 : 1);
});
