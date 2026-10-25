/** A duration as the largest two units, e.g. `47m`, `2h05m`, `3d04h`. */
export function formatDuration(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h${String(totalMinutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(totalHours / 24)}d${String(totalHours % 24).padStart(2, "0")}h`;
}

/** The first eight characters of a session id — what `claude agents` shows and `claude respawn` takes. */
export function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/** The first eight characters of a commit sha, or `?` when it is unknown. */
export function shortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 8) : "?";
}
