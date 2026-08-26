# Guardrail hooks

Condition-triggered hooks that make Muggle Test's high-value handoffs fire path-independently — no matter whether a change was built via muggle-do, superpowers, or ad-hoc edits.

## Two layers

"Harness" spans two layers, and the distinction is load-bearing:

- **Claude Code layer** — the agent runtime that fires these hooks. A guardrail is a Claude-Code-layer trigger, nothing more.
- **Muggle Test layer** — the product (muggle-do, muggle-test, the watcher). This is what a guardrail *invokes*.

A guardrail steers the model toward a Muggle Test flow; it never reimplements the flow.

Design rationale: `muggle-ai-brain/architecture/2026-06-02-harness-pipeline-integration-design.md` (original advisory design; the E2E gate and report gate below now enforce rather than advise).

## Advise vs enforce

A guardrail emits one of two strengths:

- **Advise** — `additionalContext` (PostToolUse/UserPromptSubmit) or a plain Stop message. A soft nudge the model can ignore.
- **Enforce** — a `Stop` `decision: "block"` that refuses to end the turn, or a `PreToolUse` `permissionDecision: "deny"` that refuses a tool call. The model cannot proceed until the condition is met.

Enforcement is reserved for the handoffs that were being skipped: the E2E acceptance run, posting a deterministically-rendered report, and the post-merge handoff. Each enforcing gate carries an escape so it can't trap a turn — the E2E gate accepts an explicit skip declaration (`echo "MUGGLE_E2E_SKIP: <reason>"`, session-durable) and hard-releases after `MAX_E2E_BLOCKS` (3) blocks; the report gate only denies a body it can positively see is a hand-written report and fails open otherwise; the post-merge gate hard-releases after `MAX_PR_TERMINAL_BLOCKS` (3) blocks, and only the AskUserQuestion next-options offer clears it — nothing else resets its counter.

## Mechanism

A recorder that *clears* an obligation — a walkthrough posted, a failure diagnosed, a test case classified — records only when the call did not visibly fail (`callOutcome.ts`). Recording from the request alone let a rejected `gh pr comment` mark the walkthrough posted, so the gate went quiet on a PR that never received it.

Each guardrail is a thin bash wrapper in `../scripts/` registered in `hooks.json`. The wrapper pipes the event payload (stdin JSON) to the bundled `../scripts/guardrails.mjs <subcommand>`, which holds the decision logic (built from `src/guardrails/`, vitest-covered). Per-session state in `~/.muggle-ai/guardrails/<session_id>.json` tracks what fired. Any *failure* degrades to `{}` (allow) — a gate blocks only by an explicit, tested decision, never by accident.

Each wrapper short-circuits in shell first, so the common case never pays Node cold-start. A gate that has spent its block budget stamps a `<gate>Released` flag, which its wrapper then pre-filters on — without it a released gate keeps cold-starting Node on every remaining turn end to answer `{}`, and the walkthrough gate keeps making provider calls to do it. That pre-filter is a second, looser copy of what `guardrails.mjs` matches, and it is the one place a guardrail can fail *silently*: a payload it drops — a skip marker, a reopen line, a comment edit — reaches no recorder, and the gate keeps demanding an action the user already took. Over-matching is free; under-matching is a dead escape hatch. `src/test/guardrails/hook-prefilter.test.ts` pins every payload each subcommand acts on against the wrapper guarding it, and derives the skip-marker tokens from source so a new marker is covered the moment it exists.

## Guardrails

| Hook event | Wrapper | Strength | Condition | Preference | Effect |
| :--------- | :------ | :------- | :-------- | :--------- | :----- |
| `PostToolUse` (Bash) | `guardrail-pr-opened.sh` | advise | a `gh pr create`/`gh pr ready` just succeeded | `autoWatchPR` | start a `muggle-pr-followup` watcher on the new PR |
| `PostToolUse` (Bash + muggle execute/replay/skill-emit MCP tools) | `guardrail-record-tests.sh` | record | a unit-test command passed, an E2E run happened (execute/replay call, or the muggle-test skill's own telemetry emit — which registers a clean SKIP verdict too), or an `echo "MUGGLE_E2E_SKIP: <reason>"` marker declared E2E un-runnable, or a walkthrough carrying the `build-pr-section` sentinel was posted / declared un-postable via `echo "MUGGLE_WALKTHROUGH_SKIP: <reason>"` | — | set `unitTestsGreen` / `e2eRun` / `e2eSkipped` / `walkthroughPosted` / `walkthroughSkipped` session state |
| `PostToolUse` (Bash + Monitor) | `guardrail-pr-terminal.sh` | advise | a PR just went terminal — a `gh pr merge`/`gh pr close` success line or the watch monitor's `TERMINAL pr=N` exit line (never bare `"state":"MERGED"` metadata) | — | record `terminalPending`, direct the post-merge handoff: finalize the watcher slot, tear down per `autoCleanup`, offer next options via AskUserQuestion |
| `PostToolUse` (AskUserQuestion) | `guardrail-offer-ran.sh` | record | a next-options offer ran while a terminal PR was pending | — | clear `terminalPending` — the only exit for the post-merge Stop gate |
| `PostToolUse` (Skill + muggle telemetry-skill-emit) | `guardrail-skill-stages.sh` | advise | a skill this plugin ships was invoked; its `SKILL.md` frontmatter may declare `mandatoryStages`. Registered on the skill's own MCP announcement too, so the declaration still lands if the Skill payload ever stops carrying a name | — | record `lastInvokedSkillName` + `mandatoryStages`, and name the declared files as required reading at the moment of use |
| `PostToolUse` (Read) | `guardrail-record-stage-read.sh` | record | a markdown file under a `skills/` directory was opened | — | append to `stagesRead` — how the stage gate tells a stage that was read from one that was skipped |
| `PostToolUse` (Bash + muggle telemetry-event-emit / user-feedback-create) | `guardrail-record-stage-signals.sh` | record | a Step 6f `pre-execution-classification` emit, debug-path evidence for a failed run (a `*-failure-classified\|resolved` emit or feedback naming it), or a `MUGGLE_STAGE_SKIP` / `MUGGLE_CLASSIFY_SKIP` / `MUGGLE_DEBUG_SKIP` marker | — | set `classifiedTestCaseIds` / `debuggedRuns` / the matching skip flag |
| `PostToolUse` (Bash) | `guardrail-record-comment-replies.sh` | record | an unresolved-thread fetch named review threads still awaiting an answer (classified by the `<!-- muggle-do:bot -->` marker, never the author login), a threaded reply the provider **confirmed** answered comments in one, or a `MUGGLE_REPLY_SKIP` marker deferred them | — | claim each thread and cover the comments answered, in the per-PR ledger beside the muggle-do slot |
| `PreToolUse` (Bash) | `guardrail-report-format.sh` | **enforce** | a `gh pr comment\|create\|edit` body — or a `gh api … issues/comments/<id>` PATCH editing one — reads like an E2E report but lacks the `build-pr-section` sentinel | — | **deny** — render via `muggle build-pr-section` instead |
| `PreToolUse` (muggle local execute/replay) | `guardrail-classify-gate.sh` | **enforce** | `muggle-test` is the skill in play and the target test case has no `pre-execution-classification` this session | — | **deny** — run Step 6f first (it calls `muggle-remote-test-script-list`, which is where the run learns the case has never passed) or record a legitimate skip via `MUGGLE_CLASSIFY_SKIP`. Scoped to `muggle-test`, so the single-target skills that legitimately skip classification are untouched; fails open when the test case can't be resolved |
| `Stop` | `guardrail-e2e-gate.sh` | **enforce** | unit tests passed this session, no E2E ran yet, and no skip was recorded | `autoE2ETest` | **block** the turn until E2E runs via `muggle-test` or a `MUGGLE_E2E_SKIP` marker records a legitimate skip (full message once, one-line reminders after; releases after 3 blocks) |
| `Stop` | `guardrail-terminal-gate.sh` | **enforce** | a PR went terminal this session and the AskUserQuestion next-options offer hasn't run since | — | **block** the turn until the post-merge handoff runs (full message once, one-line reminders after; releases after 3 blocks; nothing but the offer resets the counter) |
| `Stop` | `guardrail-watch-gate.sh` | **enforce** | a PR opened this session that no `muggle-do` session slot tracks | `autoWatchPR` | **block** the turn until a slot is seeded via `muggle-pr-followup` or a `MUGGLE_WATCH_SKIP` marker records a legitimate skip (releases after 3 blocks) |
| `Stop` | `guardrail-walkthrough-gate.sh` | **enforce** | an E2E acceptance run happened this session and a PR in play — opened this session or on the working branch — carries no walkthrough in its body or comments | `postPRVisualWalkthrough` | **block** the turn until the walkthrough is posted via `muggle-pr-visual-walkthrough` or a `MUGGLE_WALKTHROUGH_SKIP` marker records a legitimate skip (releases after 3 blocks; an unreachable PR fails open to not-owed) |
| `Stop` | `guardrail-stage-gate.sh` | **enforce** | a skill invoked this session declared `mandatoryStages` and one of those files was never opened | — | **block** the turn until the stages are read or a `MUGGLE_STAGE_SKIP` marker records a legitimate skip (releases after 3 blocks) |
| `Stop` | `guardrail-debug-path-gate.sh` | **enforce** | a local execution returned a non-passing run this session and nothing routed it through `_shared/debug-failed-run.md` | — | **block** the turn until the run is diagnosed (its `*-failure-classified` emit or feedback naming it) or a `MUGGLE_DEBUG_SKIP: <runId> <reason>` marker clears that run (releases after 3 blocks) |
| `Stop` | `guardrail-comment-reply-gate.sh` | **enforce** | this session claimed a review thread and left one of its comments uncovered | — | **block** the turn until each comment gets its threaded reply per `do/per-comment-replies.md` or a `MUGGLE_REPLY_SKIP: <comment-id> <reason>` marker defers it (releases after 3 blocks). The claim is the signal, not a push, so a round that answers a question with no code change is caught too; a thread another session claimed never blocks this one |
| `Stop` | `guardrail-capability-claim.sh` | **enforce** | the closing turn tells the user an email- or login-gated flow can't be tested, reached, or verified | — | **block** once, citing `_shared/identity-and-inbox.md`: the managed profile's live inbox, stored credentials, and CAPTCHA solver clear exactly that blocker. Reads the claim out of the transcript, since a Stop payload carries no message text. Per-sentence matching, and a sentence naming SMS/phone OTP or authenticator TOTP never fires — those limits are real. Nudges once per session, then stays quiet, so a misread costs one turn |
| `UserPromptSubmit` | `guardrail-build-router.sh` | advise | a build/implement/fix request (first one this session) | `autoRouteBuildToMuggleDo` | route the work through `muggle-do` (build delegated to superpowers) |

## Session-start reconcile nudge

`SessionStart` (`scripts/reconcile-stale-watchers.sh`) — a standalone advisory, not part of the `guardrails.mjs` decision tree above.

`muggle-pr-followup` watchers are session-only (a monitor or `/loop` cron); they die with their session, leaving open PRs with no live poller. This is by design — a review is addressed only inside a session that carries the context to address it. The skill's [`reconcile`](../skills/muggle-pr-followup/reconcile.md) procedure recovers them at the next session start — finalizes slots whose PR went terminal, sweeps orphan crons, re-arms silently-stopped open watchers — but re-arming needs Claude tools a shell hook can't call. So this hook nudges rather than acts.

The nudge counts only slots **this session owns**, and reports the rest as orphans it will not act on — ownership and the recovery rules it gates are defined in [`reconcile`](../skills/muggle-pr-followup/reconcile.md). Nothing owned and nothing orphaned → it emits nothing. A pure directory scan (no `gh`, no writes), so it's cheap enough for every session start.

## Session-start state GC

`SessionStart` (`scripts/gc-state.sh`) — prunes ephemeral state that nothing else garbage-collects, so it doesn't grow without bound (the per-session guardrails files and finalized watcher slots otherwise accumulate one-per-session forever). Collection is keyed on **inactivity, never creation age**, so state a long-lived session still relies on is never deleted out from under it:

- `~/.muggle-ai/guardrails/*.json` (one per session) is pruned only after 14 days of **no activity**. An in-use session keeps rewriting its file (`guardrails.mjs` on every guarded tool call) and this hook refreshes it on every resume, so its mtime tracks last activity — a session that runs for months stays live indefinitely, and only one that has genuinely gone quiet for the whole window (i.e. ended) is collected.
- Finalized watcher slots (`result.md` present) are pruned 30 days after finalize; their `followup.log` is forensic-only. An **open** slot — a PR watched for any length of time — has no `result.md` and is never touched.

Both windows are overridable (`MUGGLE_GUARDRAILS_TTL_DAYS`, `MUGGLE_SLOT_TTL_DAYS`). TTL-gated to once per day via a `~/.cache/muggle/state-gc-checked` marker (the current-session refresh runs every start regardless); silent and best-effort, never blocks session start. Never touches an open slot or the current session's own state.
