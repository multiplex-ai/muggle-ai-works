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

Enforcement is reserved for the handoffs that were being skipped: the E2E acceptance run and posting a deterministically-rendered report. Each enforcing gate carries an escape so it can't trap a turn — the E2E gate accepts an explicit skip declaration (`echo "MUGGLE_E2E_SKIP: <reason>"`, session-durable) and hard-releases after `MAX_E2E_BLOCKS` (3) blocks; the report gate only denies a body it can positively see is a hand-written report and fails open otherwise.

## Mechanism

Each guardrail is a thin bash wrapper in `../scripts/` registered in `hooks.json`. The wrapper pipes the event payload (stdin JSON) to the bundled `../scripts/guardrails.mjs <subcommand>`, which holds the decision logic (built from `src/guardrails/`, vitest-covered). Per-session state in `~/.muggle-ai/guardrails/<session_id>.json` tracks what fired. Any *failure* degrades to `{}` (allow) — a gate blocks only by an explicit, tested decision, never by accident.

## Guardrails

| Hook event | Wrapper | Strength | Condition | Preference | Effect |
| :--------- | :------ | :------- | :-------- | :--------- | :----- |
| `PostToolUse` (Bash) | `guardrail-pr-opened.sh` | advise | a `gh pr create`/`gh pr ready` just succeeded | `autoWatchPR` | start a `muggle-pr-followup` watcher on the new PR |
| `PostToolUse` (Bash + muggle execute/replay MCP tools) | `guardrail-record-tests.sh` | record | a unit-test command passed, an E2E run happened, or an `echo "MUGGLE_E2E_SKIP: <reason>"` marker declared E2E un-runnable | — | set `unitTestsGreen` / `e2eRun` / `e2eSkipped` session state |
| `PreToolUse` (Bash) | `guardrail-report-format.sh` | **enforce** | a `gh pr comment\|create\|edit` body reads like an E2E report but lacks the `build-pr-section` sentinel | — | **deny** — render via `muggle build-pr-section` instead |
| `Stop` | `guardrail-e2e-gate.sh` | **enforce** | unit tests passed this session, no E2E ran yet, and no skip was recorded | `autoE2ETest` | **block** the turn until E2E runs via `muggle-test` or a `MUGGLE_E2E_SKIP` marker records a legitimate skip (full message once, one-line reminders after; releases after 3 blocks) |
| `UserPromptSubmit` | `guardrail-build-router.sh` | advise | a build/implement/fix request (first one this session) | `autoRouteBuildToMuggleDo` | route the work through `muggle-do` (build delegated to superpowers) |

## Session-start reconcile nudge

`SessionStart` (`scripts/reconcile-stale-watchers.sh`) — a standalone advisory, not part of the `guardrails.mjs` decision tree above.

`muggle-pr-followup` watchers are session-only `/loop` crons; they die on session end and the 7-day `/loop` expiry, leaving open PRs with no live poller. The skill's [`reconcile`](../skills/muggle-pr-followup/reconcile.md) procedure recovers them — finalizes slots whose PR went terminal, sweeps orphan crons, re-arms silently-stopped open watchers — but re-arming needs the `CronCreate` tool, which a shell hook can't call. So this hook nudges rather than acts: it scans `~/.muggle-ai/muggle-do/sessions/*/` for open slots (a `prs.json` with no `result.md`) and, **only when one or more exist**, injects `additionalContext` telling the agent to run `/muggle:muggle-pr-followup reconcile`. Zero open slots → it emits nothing. A pure directory scan (no `gh`, no writes), so it's cheap enough for every session start.
