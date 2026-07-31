import { BackendProbe, BackendSelection, GuardRunBackend } from "./types.js";

// "degraded" still has a working user manager — only failed/offline states
// rule the scope backend out.
const SYSTEMD_USABLE_MANAGER_STATES = new Set(["running", "degraded"]);

/**
 * Picks the kernel cap mechanism for the platform, or refuses. Every backend
 * enforces the limit at spawn time — the excess process fails at creation —
 * because any after-the-fact sweeper loses the race against a fork storm.
 */
export function selectGuardRunBackend(probe: BackendProbe): BackendSelection {
  if (probe.platform === "win32") {
    return { backend: GuardRunBackend.WindowsJobObject, errorMessage: null };
  }
  if (probe.platform === "linux") {
    const managerState = (probe.systemdUserManagerState ?? "").trim();
    if (probe.hasSystemdRun && SYSTEMD_USABLE_MANAGER_STATES.has(managerState)) {
      return { backend: GuardRunBackend.LinuxSystemdScope, errorMessage: null };
    }
    if (probe.hasPrlimit) {
      return { backend: GuardRunBackend.LinuxPrlimitProcessGroup, errorMessage: null };
    }
    return {
      backend: null,
      errorMessage:
        "no process-cap backend available (need a systemd user manager or prlimit); " +
        "refusing to run the command unguarded",
    };
  }
  if (probe.platform === "darwin") {
    return { backend: GuardRunBackend.DarwinUlimitProcessGroup, errorMessage: null };
  }
  return {
    backend: null,
    errorMessage: `unsupported platform "${probe.platform}"; refusing to run the command unguarded`,
  };
}
