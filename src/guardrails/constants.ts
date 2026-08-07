// gh success lines: `✓ Merged pull request #<n> (title)` — also the
// "Squashed and merged" / "Rebased and merged" strategy variants — and
// `✓ Closed pull request owner/repo#<n> (title)`. Newer gh prefixes the number
// with owner/repo, older prints a bare `#<n>`; the optional [\w./-]* run accepts
// both. Anchoring on the full verb phrase (never a bare MERGED/CLOSED token) is
// what keeps `"state":"MERGED"` out: every `gh pr view --json`/API fetch
// carries that token, and matching it would arm the gate on a routine status
// query. It also excludes git's own merge-commit subject ("Merge pull
// request #N"), which differs by verb tense.
export const GH_PR_MERGED_LINE = /\b(?:Merged|Squashed and merged|Rebased and merged) pull request [\w./-]*#(\d+)/;
export const GH_PR_CLOSED_LINE = /\bClosed pull request [\w./-]*#(\d+)/;

// `gh pr reopen` success line: `✓ Reopened pull request owner/repo#12 (title)`.
// A reopen retracts a close, and is the only signal that un-does a terminal
// verdict. Closing and reopening is a routine maneuver — it re-fires a lost
// workflow trigger to start checks, and re-syncs a head left pointing at the
// base branch after a force-push through it — so without this the transient
// close leaves a post-merge handoff owed on a change that is open again.
export const GH_PR_REOPENED_LINE = /\bReopened pull request [\w./-]*#(\d+)/;

// The pr-followup watch monitor's exit line (e.g. `TERMINAL pr=331: MERGED`),
// which also surfaces when a monitor event notification is replayed through a
// tool result.
export const PR_MONITOR_TERMINAL_LINE = /\bTERMINAL pr=(\d+): (MERGED|CLOSED)\b/;

export const MAX_PR_TERMINAL_BLOCKS = 3;

/** How many times the watcher-arm Stop gate blocks a turn end before releasing, so a genuinely un-watchable PR can't trap the session. */
export const MAX_WATCH_BLOCKS = 3;

// The muggle-test skill's own first-step telemetry emit
// (mcp__…muggle-local-telemetry-skill-emit with skillName "muggle-test").
// Registering it as an E2E run covers the clean-SKIP verdict: the skill runs
// change detection, legitimately concludes there is no browser surface to
// drive, and ends without any execute/replay MCP call — previously the only
// signal the gate could see, so it kept blocking on changes it structurally
// couldn't test. Keyed on the emitting tool name plus its own skillName input
// (never Bash text), so casual mentions of "muggle-test" stay inert.
export const MUGGLE_SKILL_EMIT_TOOL = /muggle-local-telemetry-skill-emit/i;
export const MUGGLE_TEST_SKILL_NAME = "muggle-test";
