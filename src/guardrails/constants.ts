// gh success lines: `✓ Merged pull request #12 (title)` — also the
// "Squashed and merged" / "Rebased and merged" strategy variants — and
// `✓ Closed pull request owner/repo#12 (title)`. Newer gh prefixes the number
// with owner/repo, older prints a bare `#12`; the optional [\w./-]* run accepts
// both. Anchoring on the full verb phrase (never a bare MERGED/CLOSED token) is
// what keeps `"state":"MERGED"` out: every `gh pr view --json`/API fetch
// carries that token, and matching it would arm the gate on a routine status
// query. It also excludes git's own merge-commit subject ("Merge pull
// request #N"), which differs by verb tense.
export const GH_PR_MERGED_LINE = /\b(?:Merged|Squashed and merged|Rebased and merged) pull request [\w./-]*#(\d+)/;
export const GH_PR_CLOSED_LINE = /\bClosed pull request [\w./-]*#(\d+)/;

// The pr-followup watch monitor's exit line (e.g. `TERMINAL pr=331: MERGED`),
// which also surfaces when a monitor event notification is replayed through a
// tool result.
export const PR_MONITOR_TERMINAL_LINE = /\bTERMINAL pr=(\d+): (MERGED|CLOSED)\b/;

export const MAX_PR_TERMINAL_BLOCKS = 3;
