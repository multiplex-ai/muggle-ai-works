---
name: muggle-test-prepare
description: "Make sure dev servers and sibling services are ready on the user's machine before running E2E acceptance tests. Checks which services need to be running, discovers sibling directories by folder name, verifies what's already listening, and offers to start anything that's missing — with the user's approval at every step. Use this skill whenever the user needs to prepare their local environment for E2E testing, verify their services are up, get their local dev stack ready, or when other muggle skills detect that required services are not listening on common ports. Triggers on: 'prepare for testing', 'make sure my services are running', 'check my local env', 'get ready for tests', 'are my services up', 'prepare local environment', 'spin up services', 'set up for E2E', 'verify my setup'. Also use when muggle-test, muggle-do, or muggle-test-feature-local need services running."
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

`testing_scope` records what the user is testing (from [Step 1](./steps/step-1-what-are-you-testing.md)). `excluded_services` records services the user said can't run locally (from [Step 2](./steps/step-2-viability-check.md)).

**On every invocation**, check this file first. If it exists with live PIDs (verify with `kill -0`), `AskUserQuestion`:
- Option 1: "Keep them running — skip to testing"
- Option 2: "Tear down and start fresh"
- Option 3: "Add more services to the running set"

Prune dead PIDs silently.

## Preferences

Gates run per [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md).

| Preference | Step | Decision it gates |
|------------|------|-------------------|
| `autoRebase` | [Step 0](./steps/step-0-rebase-check.md) | Rebase onto `origin/<default>` before starting dev servers |

## Workflow

Read each step's detail file when you reach it. Steps are run in order; the inline notes are summaries, not the full instructions.

| Step | File | Summary |
|:-----|:-----|:--------|
| 0 | [step-0-rebase-check.md](./steps/step-0-rebase-check.md) | Rebase onto default branch (gated) |
| 1 | [step-1-what-are-you-testing.md](./steps/step-1-what-are-you-testing.md) | Scope: frontend / backend / full stack |
| 2 | [step-2-viability-check.md](./steps/step-2-viability-check.md) | Exclude services that can't run locally |
| 3 | [step-3-identify-services.md](./steps/step-3-identify-services.md) | Pick required services + startup mode |
| 4 | [step-4-check-running.md](./steps/step-4-check-running.md) | Detect what's already listening |
| 4.5 | [step-4.5-env-file.md](./steps/step-4.5-env-file.md) | Env file present + correct |
| 5 | [step-5-start-commands.md](./steps/step-5-start-commands.md) | Determine per-service start command |
| 5.5 | [step-5.5-fresh-install.md](./steps/step-5.5-fresh-install.md) | Auto-install deps if missing/stale |
| 6 | [step-6-start-services.md](./steps/step-6-start-services.md) | Launch + two-stage readiness |
| 7 | [step-7-smoke-test.md](./steps/step-7-smoke-test.md) | HTTP + body sniff + log tail; clean-restart on fail |
| 8 | [step-8-readiness-report.md](./steps/step-8-readiness-report.md) | Final ready table |

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
- **Idempotent** — already-tracked alive services are kept; [Step 7](./steps/step-7-smoke-test.md) still runs against them.
- **Port-listening is never enough** — Step 7 (HTTP + body sniff + log tail) is mandatory before the final report.
- **Clean Restart is the recommended fix** — Option 1 in Step 7a; lint/build/missing-deps issues need nuke-and-reinstall.
- **Fresh install is automatic** — [Step 5.5](./steps/step-5.5-fresh-install.md) notifies, doesn't ask.
