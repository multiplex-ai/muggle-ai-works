---
name: muggle-test-prepare
description: "Use this skill to get a user's local environment ready before running E2E acceptance tests — verifying that the dev servers, APIs, and sibling services they need are actually up and responding, and offering to start whatever is missing (with approval at each step). Trigger whenever the user wants to confirm that specific ports or localhost URLs are listening/up before testing (e.g. 'check if localhost:3000 and the api on 8080 are listening', 'are my services up?'), make sure required services are running, spin up or prepare their local dev stack, or verify their setup — and whenever another muggle skill (muggle-test, muggle-do, muggle-test-feature-local) needs services running but they're not listening on the expected ports. This is environment readiness and service startup, not running the tests themselves."
---

# Muggle Test Prepare

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-test-prepare"`.

Make sure the local services a user needs for E2E acceptance testing are up and ready. Check what's already running, discover sibling service directories by folder name, and offer to start anything that's missing — always with the user in control.

Some users start their own services (tmux scripts, docker-compose, a terminal per service). Others want help launching them. This skill handles both: it verifies readiness first, and only offers to start things when something is missing.

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

This file is **ephemeral runtime state**, not the saved recipe. The durable plan lives at `<repo>/.muggle-ai/prepare-plan.json` (or the parent-dir-keyed entry in `~/.muggle-ai/prepare-plans.json`) and is consulted in [reuse-plan](./steps/reuse-plan.md) before any other stage. The two files never merge.

**On every invocation**, check this file first. If it exists with live PIDs (verify with `kill -0`), `AskUserQuestion`:
- Option 1: "Keep them running — skip to testing"
- Option 2: "Tear down and start fresh"
- Option 3: "Add more services to the running set"

Prune dead PIDs silently.

## Preferences

Gates run per [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md).

| Preference | Gates |
|------------|-------|
| `autoRebase` | [rebase-check](./steps/rebase-check.md) — rebase onto `origin/<default>` before starting dev servers |
| `reusePreparePlan` | [reuse-plan](./steps/reuse-plan.md) — reuse the saved prepare plan for this stack, or rediscover |

## Workflow

Run the stages in this order. The sequence number is display-only — it lives only in this table for at-a-glance ordering; detail files and cross-references use slugs. Each row links to its detail file; read the file when you reach the stage.

| # | Stage | Summary |
|:--|:------|:--------|
| 0 | [reuse-plan](./steps/reuse-plan.md) | Reuse saved prepare plan (gated); short-circuits to check-running on reuse |
| 1 | [rebase-check](./steps/rebase-check.md) | Rebase onto default branch (gated) |
| 2 | [scope](./steps/scope.md) | Frontend / backend / full stack |
| 3 | [viability-check](./steps/viability-check.md) | Exclude services that can't run locally |
| 4 | [identify-services](./steps/identify-services.md) | Pick required services + startup mode |
| 5 | [check-running](./steps/check-running.md) | Detect what's already listening |
| 6 | [env-file](./steps/env-file.md) | Env file present + correct |
| 7 | [start-commands](./steps/start-commands.md) | Determine per-service start command |
| 8 | [fresh-install](./steps/fresh-install.md) | Auto-install deps if missing/stale |
| 9 | [start-services](./steps/start-services.md) | Launch + two-stage readiness |
| 10 | [smoke-test](./steps/smoke-test.md) | HTTP + body sniff + log tail; clean-restart on fail |
| 11 | [readiness-report](./steps/readiness-report.md) | Final ready table |

## Cleanup

Triggered when the user says "stop services", "tear down", "clean up", "I'm done testing", another skill signals run complete, or this skill is re-invoked with "tear down and start fresh".

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

- **Verify first, offer to start second** — check what's already running before proposing to start anything.
- **The user may prefer to start services themselves** — always offer that option.
- **Never start a process the user didn't approve.**
- **Never read file contents outside confirmed directories** — folder names are discoverable; file contents require explicit user selection.
- **Never leave orphan processes untracked** — every background PID goes into the tracking file.
- **Never kill a process the user started independently** — `external: true` survives cleanup.
- **Never assume start commands** — verify via indicator file; confirm with user.
- **Bail early on non-viable services** — don't start what can't run locally.
- **Idempotent** — already-tracked alive services are kept; [smoke-test](./steps/smoke-test.md) still runs against them.
- **Port-listening is never enough** — smoke-test (HTTP + body sniff + log tail) is mandatory before the final report.
- **Clean Restart is the recommended fix** — first option in the smoke-test diagnose-and-fix loop; lint/build/missing-deps issues need nuke-and-reinstall.
- **Fresh install is automatic** — [fresh-install](./steps/fresh-install.md) notifies, doesn't ask.
