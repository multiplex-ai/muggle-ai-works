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

Each guardrail is a thin bash wrapper in `../scripts/` registered in `hooks.json`. The wrapper pipes the event payload (stdin JSON) to the bundled `../scripts/guardrails.mjs <subcommand>`, which holds the decision logic (built from `src/guardrails/`, vitest-covered). Per-session state in `~/.muggle-ai/guardrails/<session_id>.json` tracks what fired. Any *failure* degrades to `{}` (allow) — a gate blocks only by an explicit, tested decision, never by accident.

## Guardrails

| Hook event | Wrapper | Strength | Condition | Preference | Effect |
| :--------- | :------ | :------- | :-------- | :--------- | :----- |
| `PostToolUse` (Bash) | `guardrail-pr-opened.sh` | advise | a `gh pr create`/`gh pr ready` just succeeded | `autoWatchPR` | start a `muggle-pr-followup` watcher on the new PR |
| `PostToolUse` (Bash + muggle execute/replay/skill-emit MCP tools) | `guardrail-record-tests.sh` | record | a unit-test command passed, an E2E run happened (execute/replay call, or the muggle-test skill's own telemetry emit — which registers a clean SKIP verdict too), or an `echo "MUGGLE_E2E_SKIP: <reason>"` marker declared E2E un-runnable | — | set `unitTestsGreen` / `e2eRun` / `e2eSkipped` session state |
| `PostToolUse` (Bash + Monitor) | `guardrail-pr-terminal.sh` | advise | a PR just went terminal — a `gh pr merge`/`gh pr close` success line or the watch monitor's `TERMINAL pr=N` exit line (never bare `"state":"MERGED"` metadata) | — | record `terminalPending`, direct the post-merge handoff: finalize the watcher slot, tear down per `autoCleanup`, offer next options via AskUserQuestion |
| `PostToolUse` (AskUserQuestion) | `guardrail-offer-ran.sh` | record | a next-options offer ran while a terminal PR was pending | — | clear `terminalPending` — the only exit for the post-merge Stop gate |
| `PreToolUse` (Bash) | `guardrail-report-format.sh` | **enforce** | a `gh pr comment\|create\|edit` body reads like an E2E report but lacks the `build-pr-section` sentinel | — | **deny** — render via `muggle build-pr-section` instead |
| `Stop` | `guardrail-e2e-gate.sh` | **enforce** | unit tests passed this session, no E2E ran yet, and no skip was recorded | `autoE2ETest` | **block** the turn until E2E runs via `muggle-test` or a `MUGGLE_E2E_SKIP` marker records a legitimate skip (full message once, one-line reminders after; releases after 3 blocks) |
| `Stop` | `guardrail-terminal-gate.sh` | **enforce** | a PR went terminal this session and the AskUserQuestion next-options offer hasn't run since | — | **block** the turn until the post-merge handoff runs (full message once, one-line reminders after; releases after 3 blocks; nothing but the offer resets the counter) |
| `UserPromptSubmit` | `guardrail-build-router.sh` | advise | a build/implement/fix request (first one this session) | `autoRouteBuildToMuggleDo` | route the work through `muggle-do` (build delegated to superpowers) |

## Session-start reconcile nudge

`SessionStart` (`scripts/reconcile-stale-watchers.sh`) — a standalone advisory, not part of the `guardrails.mjs` decision tree above.

`muggle-pr-followup` watchers are session-only (a monitor or `/loop` cron); they die with their session, leaving open PRs with no live poller. The skill's [`reconcile`](../skills/muggle-pr-followup/reconcile.md) procedure recovers them — finalizes slots whose PR went terminal, sweeps orphan crons, re-arms silently-stopped open watchers — but re-arming needs Claude tools a shell hook can't call. So this hook nudges rather than acts: it scans `~/.muggle-ai/muggle-do/sessions/*/` for open slots (a `prs.json` with no `result.md`) and, **only when one or more exist**, injects `additionalContext` telling the agent to run `/muggle:muggle-pr-followup reconcile`. Zero open slots → it emits nothing. A pure directory scan (no `gh`, no writes), so it's cheap enough for every session start.

## Out-of-session watchdog ensure

`SessionStart` (`scripts/ensure-pr-watchdog.sh`) — the nudge's counterpart for the case no session ever starts. A session that hits its usage limit kills every watch monitor mid-stream, and until a human opens the next session the nudge above never fires. When any open slot exists, this hook ensures the detached watchdog daemon (`scripts/pr-followup-watchdog.mjs`, bundled from `src/watchdog/`) is running: a singleton (lockfile pid + heartbeat) that outlives the session, scans open slots on an interval, polls dead ones with plain `gh`/`glab` calls (per the slot's provider), and spawns a headless `claude -p` recovery tick when a slot needs one — retrying through usage-limit windows so watchers resume at limit reset with no user action. Zero open slots → the hook exits without spawning, and a daemon whose last open slot closes exits on its own. Full behavior: [`reconcile.md` § Out-of-session watchdog](../skills/muggle-pr-followup/reconcile.md#out-of-session-watchdog).

Cost: zero open slots — the common case — is one directory scan, no `node` spawn. With open slots the hook adds one short-lived `node` liveness check (tens of ms). The daemon is a single idle process waking every 5 minutes for local file stats; it makes provider API calls only for a slot whose liveness beacons are stale (2–4 per dead slot per scan, zero while watchers are live) and spends model tokens only when a recovery tick actually spawns.

## Session-start state GC

`SessionStart` (`scripts/gc-state.sh`) — prunes ephemeral state that nothing else garbage-collects, so it doesn't grow without bound (the per-session guardrails files and finalized watcher slots otherwise accumulate one-per-session forever). Deletes `~/.muggle-ai/guardrails/*.json` older than 14 days (each is read only by its own session's hooks) and finalized watcher slots — `result.md` present — older than 30 days (their `followup.log` is forensic-only). TTL-gated to once per day via a `~/.cache/muggle/state-gc-checked` marker; silent and best-effort, never blocks session start. Never touches an open slot (no `result.md`) or the current session's own state.
