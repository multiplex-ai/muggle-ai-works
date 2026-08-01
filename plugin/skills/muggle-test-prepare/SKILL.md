---
name: muggle-test-prepare
model: opus
description: "Get a user's local environment ready before running E2E acceptance tests — verify the dev servers, APIs, and sibling services they need are up and responding, and offer to start whatever is missing (with approval per step). Trigger when the user wants to confirm specific ports or localhost URLs are listening before testing (check if localhost:3000 and the api on 8080 are up, are my services running), spin up their local dev stack, or verify their setup — and whenever another muggle skill (muggle-test, muggle-do, muggle-test-feature-local) needs services running but they're not. This is environment readiness and service startup, not running the tests."
---

# Muggle Test Prepare

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-test-prepare"`.

Make sure the local services a user needs for E2E acceptance testing are up and ready. Check what's already running, discover sibling service directories by folder name, and offer to start anything that's missing — always with the user in control.

Some users start their own services (tmux scripts, docker-compose, a terminal per service). Others want help launching them. This skill handles both: it verifies readiness first, and only offers to start things when something is missing.

The skill runs in two phases. **Decide (in-session):** every user-facing choice — plan reuse, scope, exclusions, service selection, start approvals — resolved here, in conversation. **Execute (agent):** the resolved plan dispatches to the `test-prepare-runner` agent (`plugin/agents/test-prepare-runner.md`), whose `model: opus` frontmatter — unlike this file's `model:` — holds even when the skill fires mid-session in a cheaper-model conversation. Other skills gate on this skill's readiness verdict, so execution must never run below its reliability floor; that pin gap is why execution lives in the agent.

## Privacy Boundary

This skill touches the user's local machine — processes, ports, directories outside the current repo. Every action is explicit and confirmed.

- **Folder names are public.** You may list directory names in a parent folder to discover sibling services.
- **File contents are private until confirmed.** Never read files inside a directory the user hasn't explicitly identified as a service to start. Once confirmed, you may inspect only top-level project indicator files (`package.json`, `Makefile`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `docker-compose.yml`) to determine the start command.
- **Never traverse upward more than one level** from the current working directory to list folders.

## PID Tracking

All launched processes are tracked in `/tmp/muggle-test-prepare.json`:

```json
{
  "session_started": "2025-01-15T10:30:00Z",
  "testing_scope": "frontend",
  "excluded_services": [
    {"name": "payment-gateway", "reason": "Needs production certificates"}
  ],
  "services": [
    {
      "name": "backend-api",
      "dir": "/Users/user/Github/backend-api",
      "command": "npm run dev",
      "pid": 12345,
      "port": 3001,
      "log": "/tmp/muggle-prepare-backend-api.log"
    }
  ]
}
```

`testing_scope` records what the user is testing (from [scope](./steps/scope.md)). `excluded_services` records services the user said can't run locally (from [viability-check](./steps/viability-check.md)).

This file is **ephemeral runtime state**, not the saved recipe. The durable plan lives at `<repo>/.muggle-ai/prepare-plan.json` (or the parent-dir-keyed entry in `~/.muggle-ai/prepare-plans.json`) and is consulted in [reuse-plan](./steps/reuse-plan.md) before any other stage. The two files never merge. The `test-prepare-runner` agent writes this file during execution; the triage below and Cleanup read it.

**On every invocation**, check this file first. If it exists with live PIDs (verify with `kill -0`), `AskUserQuestion`:
- Option 1: "Keep them running — skip to testing"
- Option 2: "Tear down and start fresh"
- Option 3: "Add more services to the running set"

Prune dead PIDs silently.

## Preferences

Gates run per [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md). All three resolve in the Decide phase; the agent receives outcomes, never gates.

| Preference | Gates |
|------------|-------|
| `autoRebase` | [rebase-check](./steps/rebase-check.md) — rebase onto `origin/<default>` before starting dev servers |
| `reusePreparePlan` | [reuse-plan](./steps/reuse-plan.md) — reuse the saved prepare plan for this stack, or rediscover |
| `autoSelectLocalHost` | [check-running](./steps/check-running.md) — reuse the recorded dev-server URL silently, or confirm it each run |

## Workflow

**Decide (in-session).** Run these stages in order; read each detail file when you reach it:

| # | Stage | Summary |
|:--|:------|:--------|
| 0 | [reuse-plan](./steps/reuse-plan.md) | Reuse saved prepare plan (gated); on reuse, skip straight to dispatch |
| 1 | [rebase-check](./steps/rebase-check.md) | Rebase onto default branch (gated) |
| 2 | [scope](./steps/scope.md) | Frontend / backend / full stack |
| 3 | [viability-check](./steps/viability-check.md) | Exclude services that can't run locally |
| 4 | [identify-services](./steps/identify-services.md) | Pick required services + startup mode |

The Decide phase's output is the **resolved prepare plan**: `services[]` (name, dir, start command, expected port, `external` flag, approval granted), `testingScope`, `excludedServices[]`, the recorded dev-server URL, and resolved gate outcomes.

**Execute (agent).** Dispatch the `test-prepare-runner` agent (subagent type `muggle:test-prepare-runner`; bare `test-prepare-runner` where the plugin namespace is absent), synchronously, passing the resolved plan. The agent runs [check-running](./steps/check-running.md), [env-file](./steps/env-file.md), [start-commands](./steps/start-commands.md), [fresh-install](./steps/fresh-install.md), [start-services](./steps/start-services.md), [smoke-test](./steps/smoke-test.md), and [readiness-report](./steps/readiness-report.md), and returns `READY` / `DEGRADED` plus the readiness table. In a harness with no agent/subagent facility, execute those stage files inline instead.

Relay the readiness table to the user or calling skill verbatim. A `needs-input:` line from the agent names an unresolved decision — resolve it here (asking the user if needed) and re-dispatch; the agent never asks.

## Cleanup

Triggered when the user says "stop services", "tear down", "clean up", "I'm done testing", another skill signals run complete, or this skill is re-invoked with "tear down and start fresh". Runs in-session, not in the agent.

1. Read `/tmp/muggle-test-prepare.json`
2. Skip services marked `external: true`
3. For each managed service: `kill <pid>` (SIGTERM)
4. Wait ~2 s, verify with `kill -0`
5. If still alive: `kill -9 <pid>`
6. `rm -f /tmp/muggle-prepare-*.log`
7. `rm -f /tmp/muggle-test-prepare.json`

Report:

```
Stopped 3 services:
  backend-api    (PID 12345)
  auth-service   (PID 12346)
  frontend       (PID 12347)
```

## Integration Contract (for other skills)

`muggle-test-feature-local`, `muggle-do`, and local-mode `muggle-test` MUST invoke this skill before any workflow step. Idempotent — fast exit when healthy. Treat success as short-lived; re-invoke if more than a few minutes pass before testing. Never bypass on "the user knows their stack is up" — that assumption is why this skill exists.

After a test run, the caller can re-invoke for cleanup or leave services running for the next run.

## Guardrails

- **Never invent or default a host/port** — the dev-server URL is a recorded value, not a guess. Resolve it from `<repo>/.muggle-ai/last-host.json` (the [`autoSelectLocalHost`](../muggle-preferences/preference-gates/autoSelectLocalHost.md) cache) before probing ports; a framework default like `:3000` is never a fallback. See [check-running](./steps/check-running.md).
- **No silent auto-selection without a gate** — when no preference authorizes a silent choice (host, restart, kill), confirm with the user. A gate set to `always` is the only license to skip the question; absent that, ask.
- **Verify first, offer to start second** — check what's already running before proposing to start anything.
- **The user may prefer to start services themselves** — always offer that option.
- **Never start a process the user didn't approve** — approvals are granted in Decide and travel in the plan; the agent starts nothing outside it.
- **Never read file contents outside confirmed directories** — folder names are discoverable; file contents require explicit user selection.
- **Never leave orphan processes untracked** — every background PID goes into the tracking file.
- **Never kill a process the user started independently** — `external: true` survives cleanup.
- **Never assume start commands** — verify via indicator file; confirm with user.
- **Bail early on non-viable services** — don't start what can't run locally.
- **Idempotent** — already-tracked alive services are kept; [smoke-test](./steps/smoke-test.md) still runs against them.
- **Port-listening is never enough** — smoke-test (HTTP + body sniff + log tail) is mandatory before the final report.
- **Clean Restart is the recommended fix** — first option in the smoke-test diagnose-and-fix loop; lint/build/missing-deps issues need nuke-and-reinstall.
- **Fresh install is automatic** — [fresh-install](./steps/fresh-install.md) notifies, doesn't ask.
