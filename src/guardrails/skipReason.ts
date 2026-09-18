// Anchored to a leading echo for the same reason the skip markers themselves
// are: a grep, a commit, or a skill edit that merely mentions the token must
// not be read as a declaration — and must not post a reason to a PR.
const SKIP_DECLARATION = /^\s*echo\s+["']?MUGGLE_(?:E2E|WALKTHROUGH)_SKIP:\s*(.+)$/;

/** The stated reason in an `echo "MUGGLE_*_SKIP: <reason>"` declaration; `null` when the command states none. */
export function skipReasonFrom(cmd: string): string | null {
  const declared = cmd.match(SKIP_DECLARATION);
  if (!declared) return null;
  const reason = declared[1].replace(/["']\s*$/, "").trim();
  return reason || null;
}
