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

/** How many times the walkthrough Stop gate blocks a turn end before releasing, so a result that genuinely can't be posted can't trap the session. */
export const MAX_WALKTHROUGH_BLOCKS = 3;

/** Ceiling on each `gh` lookup the walkthrough gate runs at turn end; a hung call must never hold the turn open. */
export const GH_LOOKUP_TIMEOUT_MS = 10_000;

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

/** Optional SKILL.md frontmatter key holding the stage files a skill cannot be executed without. */
export const MANDATORY_STAGES_FRONTMATTER_KEY = "mandatoryStages";

// The Skill tool's input key for the invoked skill has differed across harness
// versions (and Cursor's equivalent), so the resolver reads the first of these
// that carries a string. The bash wrapper builds its extraction from the same
// list — a key present in one and missing from the other makes the gate dead
// code for exactly the harness that names it that way.
export const SKILL_NAME_INPUT_KEYS = ["skill", "skillName", "name", "command"] as const;

/** How many times the mandatory-stage Stop gate blocks a turn end before releasing, so a stage that genuinely can't be read can't trap the session. */
export const MAX_STAGE_BLOCKS = 3;

/** How many times the debug-path Stop gate blocks a turn end before releasing, so a failure with no reachable evidence can't trap the session. */
export const MAX_DEBUG_BLOCKS = 3;

// Recorded when a pre-execution-classification event carries no testCaseId.
// The field is optional in the emit schema, so an otherwise-correct Step 6f
// would deny the very run it classified; the wildcard makes the gate treat the
// batch as classified rather than block work that actually followed the step.
export const ANY_TEST_CASE = "*";

// The local execution tools the classification gate stands in front of, and the
// pair whose non-passing result owes a debug path. Both burn a real browser run
// (~5 minutes), which is what makes a pre-flight check worth a hook.
export const MUGGLE_EXECUTION_TOOL = /muggle-local-(execute-test-generation|execute-replay)/i;

/** The telemetry emit that carries the Step 6f / debug-path decisions the stage gates key on. */
export const MUGGLE_EVENT_EMIT_TOOL = /muggle-local-telemetry-event-emit/i;

/** The feedback submission that counts as debug-path evidence for the run it names. */
export const MUGGLE_FEEDBACK_CREATE_TOOL = /muggle-remote-user-feedback-create/i;

/** Step 6f's event type — the classification that calls `muggle-remote-test-script-list` before a run is spent. */
export const PRE_EXECUTION_CLASSIFICATION_EVENT = "pre-execution-classification";

/** The debug path's own telemetry events (`replay-`/`regen-failure-classified|resolved`), each carrying the runId it diagnosed. */
export const FAILURE_DIAGNOSIS_EVENT = /-failure-(classified|resolved)$/;

// A local execute/replay result is markdown the MCP tool renders itself, so the
// run id and verdict are pinned to that rendering rather than guessed from a
// JSON shape the hook never sees.
export const MUGGLE_RUN_ID_LINE = /\*\*Run ID:\*\*\s*([^\s*]+)/;
export const MUGGLE_RUN_STATUS_LINE = /\*\*Status:\*\*\s*([A-Za-z_]+)/;
export const MUGGLE_RUN_PASSED_STATUS = "passed";

// GitHub's GraphQL mutation that closes a review thread. The `\b` prefix is
// load-bearing: `unresolveReviewThread` re-opens a thread — the opposite act,
// and one a reviewer may legitimately want — so it must not match here.
export const GITHUB_RESOLVE_THREAD_MUTATION = /\bresolveReviewThread\b/;

// GitLab's REST equivalent: a PUT on a discussion carrying `resolved=true`.
// `resolved=false` re-opens and stays allowed, mirroring the GitHub arm.
export const GITLAB_RESOLVE_DISCUSSION_CALL = /discussions\/[^\s"']*[?&]resolved=true/i;

// Only a real API invocation is a resolve. Without this, the gate would also
// deny greps, doc reads, and the skill files that name the mutation to forbid
// it — including the very tests that assert this guardrail works.
export const PROVIDER_API_INVOCATION = /\b(?:gh|glab)\s+api\b/;

// The hidden marker `sign-body.sh --mode loop` prefixes onto every comment the
// loop posts (plugin/skills/_shared/pr-followup-helpers/loop-signature.md). It
// is the only reliable loop-vs-human signal — under a shared account the author
// login is ambiguous — so the reply gate classifies threads by it, exactly as
// the unresolved-thread recipes do.
export const LOOP_REPLY_MARKER = "<!-- muggle-do:bot -->";

// The unresolved-thread fetches a review round works from: GitHub's
// `reviewThreads` GraphQL query and GitLab's MR discussions listing. Their
// responses are the only place the round sees which threads still await an
// answer, which makes them the gate's owed-reply source.
export const REVIEW_THREAD_FETCH_COMMAND = /reviewThreads|merge_requests\/\d+\/discussions/;

// The threaded-reply POSTs, each carrying the id it answers: GitHub's
// `/pulls/<n>/comments/<id>/replies` and GitLab's `/discussions/<id>/notes`.
export const THREADED_REPLY_TARGET = /pulls\/\d+\/comments\/(\d+)\/replies|discussions\/([\w-]+)\/notes/g;

// What counts as having acted on the review: the push that carries the change.
// Both paths qualify — a local `git push` and the remote `createCommitOnBranch`
// mutation the signed-commits recipe routes through when local signing is
// broken — because a gate that only knew one would go quiet for whichever half
// of the fleet uses the other.
export const REVIEW_WORK_PUSH_COMMAND = /\bgit\s[^\n]*\bpush\b|\bcreateCommitOnBranch\b/;

/** How many times the comment-reply Stop gate blocks a turn end before releasing, so a thread that genuinely cannot be answered can't trap the session. */
export const MAX_REPLY_BLOCKS = 3;

/** How long a session-state write waits for the lock before dropping itself. The store sits in the critical path of every tool call, so a guardrail must never stall the harness on contention. */
export const SESSION_STATE_LOCK_WAIT_MS = 250;

/** How often a waiter re-probes a lock it could not take. */
export const LOCK_POLL_INTERVAL_MS = 10;
