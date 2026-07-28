export enum GuardRunBackend {
  WindowsJobObject = "windows-job-object",
  LinuxSystemdScope = "linux-systemd-scope",
  LinuxPrlimitProcessGroup = "linux-prlimit-process-group",
  DarwinUlimitProcessGroup = "darwin-ulimit-process-group",
}

export interface GuardRunOptions {
  activeProcessLimit: number;
  isServiceMode: boolean;
  command: string[];
}

export interface GuardRunParseResult {
  options: GuardRunOptions | null;
  errorMessage: string | null;
}

export interface BackendProbe {
  platform: string;
  hasSystemdRun: boolean;
  /** Trimmed stdout of `systemctl --user is-system-running`, or null when unprobed. */
  systemdUserManagerState: string | null;
  hasPrlimit: boolean;
}

export interface BackendSelection {
  backend: GuardRunBackend | null;
  errorMessage: string | null;
}

export interface BackendLaunchPlan {
  executable: string;
  args: string[];
  /** POSIX: own process group, so non-service cleanup can kill the whole group. */
  spawnDetached: boolean;
  killsProcessGroupOnExit: boolean;
  /** systemd scope unit to stop when the launcher exits in non-service mode. */
  stopsScopeUnitOnExit: string | null;
}
