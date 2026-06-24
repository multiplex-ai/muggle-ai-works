// Node surfaces a Windows Application Control block (Smart App Control / WDAC refusing to
// launch the unsigned binary) as a bare `spawn UNKNOWN` with no stderr — undiagnosable
// unless we translate it into the cause and the way out.
export function describeElectronSpawnFailure(params: {
  error: NodeJS.ErrnoException;
  electronAppPath: string;
  platform?: NodeJS.Platform;
}): string {
  const base = `Failed to start electron-app: ${params.error.message}`;
  const platform = params.platform ?? process.platform;
  const blockedByAppControl =
    platform === "win32" && (params.error.code === "UNKNOWN" || params.error.code === "EPERM");
  if (!blockedByAppControl) {
    return base;
  }
  return [
    base,
    "",
    "This is almost certainly Windows Smart App Control (or a WDAC policy) blocking the",
    "Muggle desktop app because it is not yet code-signed: the OS refuses to launch the",
    "binary before it starts, so there is no output and the run fails in 0ms.",
    "",
    `  Binary: ${params.electronAppPath}`,
    "  Confirm: launch the binary directly, or check Event Viewer > Applications and Services",
    '  Logs > Microsoft > Windows > CodeIntegrity (events 3033/3077) for "An Application',
    '  Control policy has blocked this file."',
    "",
    "  To run Muggle now: Settings > Privacy & security > Windows Security > App & browser",
    "  control > Smart App Control > Off. A signed build that passes Smart App Control is on the way.",
  ].join("\n");
}
