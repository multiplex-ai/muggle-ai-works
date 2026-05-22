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

The `testing_scope` field records what the user is testing (from Step 1). The `excluded_services` field records services the user said can't run locally (from Step 2), so other skills understand what's intentionally absent vs. forgotten.

**On every invocation**, check this file first. If it exists with live PIDs (verify with `kill -0`), present the running services and ask:

Use `AskUserQuestion`:
- Option 1: "Keep them running — skip to testing"
- Option 2: "Tear down and start fresh"
- Option 3: "Add more services to the running set"

Prune any dead PIDs silently (the process crashed on its own — no point asking about it).

## Preferences

Gates run per [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md).

| Preference | Step | Decision it gates |
|------------|------|-------------------|
| `autoRebase` | 0 | Rebase onto `origin/<default>` before starting dev servers (see [`_shared/rebase-before-e2e.md`](../_shared/rebase-before-e2e.md)) |

## Workflow

### Step 0: Rebase check (gated by `autoRebase`)

Fire per [`_shared/rebase-before-e2e.md`](../_shared/rebase-before-e2e.md) when `behind > 0`. Otherwise skip silently.

### Step 1: What Are You Testing?

Before discovering services, understand the shape of the testing so you can scope correctly. Use `AskUserQuestion`:

> "What are you testing locally?"

- Option 1: "A frontend feature — I need the UI and its backend dependencies running"
- Option 2: "A backend API — I just need the API server running"
- Option 3: "The full stack — everything needs to be up"

This scopes the rest of the workflow. If the user is testing a backend API, they probably don't need a frontend dev server. If they're testing a frontend feature, they need the frontend plus whatever backends it talks to. Keep this answer in mind when presenting service candidates in Step 3 — pre-check the ones that match and leave the rest unchecked.

### Step 2: Viability Check

Some services can't run on a developer's machine by design — they need production secrets, HSMs, specific certificates, or cloud-only infrastructure. Don't waste time trying to discover or start them.

**If the user already volunteered this information** in their initial message (e.g., "the payment-gateway can't run locally"), acknowledge it and skip the question — don't re-ask what they already answered.

Otherwise, use `AskUserQuestion`:

> "Are there any services in your stack that **can't** run locally? (e.g., needs production secrets, specific certificates, or cloud-only infra)"

- Option 1: "All my services can run locally"
- Option 2: "Some can't — I'll tell you which"

If the user picks option 2, collect the names. Acknowledge them and exclude from discovery.

If an excluded service is a hard dependency for the app under test, **suggest testing in a preview/staging environment instead** — the user can merge first and use `/muggle-test` in remote mode, where everything is already up and running. Frame it as an alternative, not a dead end:

> "Since **payment-gateway** can't run locally, you might get better coverage by merging and running `/muggle-test` against your preview environment — everything's wired up there. Want to continue with a partial local setup, or switch to remote testing?"

- Option 1: "Continue locally — I'll work around the missing service"
- Option 2: "Switch to remote — I'll merge and test on preview"

If the user chooses remote, hand off to `/muggle-test` in remote mode and exit this skill.

### Step 3: Identify Required Services & How to Start Them

Figure out which services need to be running. Start by listing folder names in the **parent directory** of the current working directory — these are the most likely candidates.

```bash
ls -d "$(dirname "$PWD")"/*/ | xargs -I{} basename {}
```

Present folder names only (not contents) as candidates. Use `AskUserQuestion` with `multiSelect: true`:

> "Which of these need to be running for your tests?"

List each folder name as an option. Pre-check the ones that match the testing scope from Step 1 (e.g., if testing a frontend feature, pre-check the frontend and likely backends). Always include these fixed tail options:
- "Just the current project (no other services needed)"
- "None of these — I'll tell you what I need"

If the user provides manual paths, verify they exist before continuing. If a path doesn't exist, report it and ask for correction.

**Include the current working directory as a candidate** — the user might be editing the backend but also need the frontend (a sibling) started, or vice versa.

**Immediately after the user selects services**, ask how they want to handle startup. This avoids making someone who prefers their own scripts wait through command detection before they get to say "I'll handle it."

Use `AskUserQuestion`:

> "How do you want to handle these?"

- Option 1: "Check what's running, start what's missing for me"
- Option 2: "I'll start them myself — just verify they're up when I'm done"

If the user picks **option 2**: skip Steps 4-6. Wait for them to confirm they're ready, then go straight to Step 4 (Check What's Already Running) to verify everything is listening, run Step 7 (comprehensive smoke test) against everything, and report readiness (Step 8). The user-started case is exactly where the smoke test matters most — the skill has no insight into how those services were started, so the only signal that they actually work is the HTTP + body-sniff check.

If the user picks **option 1**: proceed through Steps 4-7 as normal.

### Step 4: Check What's Already Running

Run port detection and (when the app declares a backend URL) backend-health probe per [`_shared/dev-server-readiness.md`](../_shared/dev-server-readiness.md). Cross-reference hits against the selected service directories. If a selected service appears to already be running (match by port or by the process's working directory), report it as ready:

> "**backend-api** is already listening on port 3001 (PID 54321) — looks good."

If **all** required services are already running, skip straight to Step 7 (comprehensive smoke test) — don't trust port-listening alone. No need to go through Steps 5-6.

If some are running and some aren't, acknowledge the running ones and continue to Step 5 only for the missing services. Use `AskUserQuestion` for any already-running service the user might want restarted:
- Option 1: "It's fine, keep it"
- Option 2: "Restart it"

For services that are already running and the user wants to keep, add them to the PID tracking file so cleanup can find them later, but mark them as `external: true` so cleanup knows not to kill them (the user started them independently).

**Port already held** — when the user wants a port that is currently held by a process they did **not** select (typically a stale dev server from a sibling worktree). Surface the conflict via `AskUserQuestion`:

> "Port 3999 is held by PID 87421 (you didn't select this process). How do you want to proceed?"

- Option 1: "Use the next available port" (recommended — non-destructive)
- Option 2: "Force-kill PID 87421 and claim port 3999"
- Option 3: "Abort"

**Option 1 — next available port:** probe `3999 + N` for `N = 1, 2, 3, ...` until `Test-NetConnection`/`lsof -i :<port>` returns nothing listening. Record the new port (and the env file edit, if `PORT=` is set in `.env.local` etc.) so downstream steps use it. The dev server may need a restart to pick up the new value.

**Option 2 — force-kill (destructive):**
- **Windows PowerShell:** `Get-NetTCPConnection -LocalPort <port> -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch { } }`
- **POSIX:** `lsof -ti:<port> 2>/dev/null | xargs -r kill -9`

Re-verify the port is free before continuing.

### Step 4.5: Environment File Sanity

The env file is **per-repo** — don't hardcode `.env.local`. Detect it: scan `package.json` `scripts/*` for `.env*` literals and known port vars (`PORT=`, `VITE_PORT=`); check framework config (`next.config.*`, `vite.config.*`).

When a dependency on an env file exists:

1. Check whether `<cwd>/<envfile>` exists. If yes, no-op.
2. If absent, `git worktree list --porcelain` and check each sibling for the same filename.
3. If found, surface via `AskUserQuestion`:

   > "`<envfile>` is missing in this worktree but exists at `<sibling>/<envfile>`. Copy it before starting services?"

   - Option 1: "Yes — copy from `<sibling>`"
   - Option 2: "No — I'll provide it another way"

4. If not found anywhere, report and ask how to proceed.

Skip silently when no env file is referenced. The point is to catch the common worktree-bootstrap miss, not to mandate any specific file.

### Step 5: Determine Start Commands

For each required service that isn't already running, figure out how to start it. Propose the command so there's a shared understanding.

Read **only** the indicator file that exists — don't read additional files.

**Detection order:**

| Indicator | Stack | Default command | What to check |
|:----------|:------|:----------------|:--------------|
| `package.json` | Node.js | `npm run dev` | Read `scripts` field: prefer `dev` > `start` > `serve` |
| `Makefile` | Various | `make dev` | Just check existence; propose `make dev` or `make run` |
| `Cargo.toml` | Rust | `cargo run` | Just check existence |
| `go.mod` | Go | `go run .` | Just check existence |
| `pyproject.toml` | Python | Check for framework | Read `[project.scripts]` or `[tool.poetry.scripts]` if present |
| `requirements.txt` | Python | `python app.py` | Just check existence |
| `docker-compose.yml` | Docker | `docker compose up` | Just check existence |

If no indicator file is found, tell the user and ask them to provide the start command manually.

**Present all proposed commands in a single summary:**

```
Service              Directory                          Command
────────────────────────────────────────────────────────────────
backend-api          ~/Github/backend-api               npm run dev
auth-service         ~/Github/auth-service              go run .
frontend             ~/Github/frontend                  npm run dev
────────────────────────────────────────────────────────────────
```

Use `AskUserQuestion`:
- Option 1: "Looks good, start them"
- Option 2: "I need to edit some commands"

If the user needs edits, collect corrections and re-present.

### Step 5.5: Fresh Install (clean-start default)

Before launching `npm run dev` (or equivalent) in a Node service, ensure dependencies are current. Stale or missing `node_modules/` causes silent runtime failures that look like the service is broken when actually the install is just missing — exactly the kind of "broken UI" the Step 7 comprehensive check is meant to surface, but cheaper to prevent here.

For each Node service the user selected:

1. If `<service-dir>/node_modules/` is missing entirely → install required.
2. If `<service-dir>/package-lock.json` is newer than `<service-dir>/node_modules/.package-lock.json` → install stale.
3. Otherwise → install current, no action needed.

When install is required or stale, **run it automatically** (notify, don't ask):

```bash
cd "<service-dir>" && npm install --prefer-offline --no-audit --no-fund
```

Show the user a one-line notification before kicking off (`Installing dependencies for <service-name> (node_modules <missing|stale>)…`). The only opt-out is aborting the whole skill. This is part of the clean-start guarantee — the user invoked prepare to get a working environment, and a stale install is the most common reason that fails.

**Never symlink `node_modules/` from a sibling worktree.** webpack's `resolve.symlinks: true` default rewrites paths to the shared real location; asset-identity tracking fails with `Can't handle conflicting asset info for sourceFilename`. Run a real per-worktree install.

For non-Node services (Go, Rust, Python), skip this probe — their build systems handle dependency caching differently.

### Step 6: Start Services

For each service, launch in the background:

```bash
cd "<service-dir>" && nohup <command> > /tmp/muggle-prepare-<service-name>.log 2>&1 &
echo $!
```

Capture the PID. Write all service entries to `/tmp/muggle-test-prepare.json`.

**Startup verification** — first confirm the PID is alive (`kill -0 <pid> 2>/dev/null`), then run the two-stage readiness probe per [`_shared/dev-server-readiness.md`](../_shared/dev-server-readiness.md) against `/tmp/muggle-prepare-<service-name>.log`. Cap log-tail at 60s. Halt on whatever it surfaces; do not re-implement the ready-signal patterns here.

If a service's PID dies immediately, read the last 20 lines of its log and show the user:

> "**backend-api** exited right after starting. Here's the tail of its log:"

Then ask how to proceed:
- Option 1: "Skip it and continue with the others"
- Option 2: "Let me fix it — I'll re-invoke later"

**Port discovery** — if the port isn't known upfront, after the service starts, re-scan listening ports and try to identify which new port appeared. Record it in the tracking file if found. If not found within ~10 seconds, note the port as unknown — the service may take longer to boot.

### Step 7: Comprehensive Smoke Test (mandatory, runs for every service)

Port-listening is not enough. A stale dev server binds to its port but serves a build-error overlay; a backend started without env vars listens but returns 500 on every route; a frontend with missing deps compiles to a webpack error page. Step 7 catches all three by hitting each service's actual URL and inspecting the response.

This step runs **for every service in the tracking file**, regardless of who started it (skill-managed *and* `external: true` services started by the user themselves). Skipping it because "the user said they started everything" is exactly how broken UI sneaks into test runs.

For each service, run all three probes — all three must pass:

1. **HTTP probe** — `GET <serviceUrl>` with 3 s timeout. Accept `2xx` or `3xx` (one redirect followed). Anything else fails this probe.
2. **Body sniff** — inspect the response body for known broken-build markers (see [`_shared/dev-server-readiness.md`](../_shared/dev-server-readiness.md) → "Body Sniff Patterns"). A 200 response can still be a Next.js error overlay or vite error block; the sniff catches that.
3. **Log tail** (skill-managed services only) — scan the last 200 lines of `/tmp/muggle-prepare-<service-name>.log` for failure patterns *appearing after the latest ready signal*. Skip silently for `external: true` services where the skill doesn't own the log.

Use the OS-agnostic primitives in `dev-server-readiness.md` for both the probe and the patterns. Do not re-implement here.

#### 7a — Diagnose-and-Fix Loop (fires on any service that fails the three-probe check)

When a service fails, show the user the concrete failure signal — HTTP status code, the body-sniff regex that matched (with a short surrounding snippet), or the log line — then `AskUserQuestion`:

> "**<service-name>** isn't healthy: `<concrete signal>`. How do you want to proceed?"

- Option 1: **Clean restart** (Recommended) — `kill <pid>`, re-run Step 5.5 (fresh install), restart per Step 6, then re-run Step 7 for this service
- Option 2: **Restart only** — `kill <pid>` and restart per Step 6 with no reinstall; re-run Step 7
- Option 3: **I'll fix it manually** — pause and wait for the user to signal ready; re-run Step 7 when they confirm
- Option 4: **Skip this service** — append to `excluded_services` with `reason: "failed comprehensive smoke test: <signal>"` and continue with the rest

Loop per service until it passes Step 7 or the user picks **Skip**. Cap at **3 iterations per service** — after 3 failures, force a manual-intervention pause regardless of the user's prior pick (the loop is likely chasing a real problem they need to look at directly).

For `external: true` services (the user started them themselves), don't offer Options 1 or 2 — the skill doesn't own that process. Only Options 3 (manual fix) and 4 (skip) apply.

### Step 8: Final Readiness Report

Only after every required service has passed Step 7 (or been explicitly skipped). Render the table:

```
Service              PID      Port     Status         Smoke Test
─────────────────────────────────────────────────────────────────
backend-api          12345    3001     Running        ✓ (HTTP 200, no error markers)
auth-service         12346    8080     Running        ✓ (HTTP 200, no error markers)
frontend             12347    3000     Running        ✓ (HTTP 200, no error markers)
─────────────────────────────────────────────────────────────────
All 3 services verified by Step 7 comprehensive check. Ready for E2E testing.
```

If any service was skipped via Step 7a Option 4, surface it explicitly so the calling skill (and the user) know the gap:

```
Skipped (not healthy):
  payment-gateway   — failed comprehensive smoke test: HTTP 500 on /
```

If you launched the services, also show:
```
Logs: /tmp/muggle-prepare-*.log
Cleanup: say "stop services" or re-invoke this skill.
```

## Cleanup

Cleanup is triggered when:
- The user says "stop services", "tear down", "clean up", or "I'm done testing"
- Another skill signals that a test run is complete
- This skill is re-invoked and the user chooses "tear down and start fresh"

**Cleanup steps:**

1. Read `/tmp/muggle-test-prepare.json`
2. Skip any services marked `external: true` (the user started them independently)
3. For each managed service, send `SIGTERM`: `kill <pid>`
4. Wait ~2 seconds, verify with `kill -0`
5. If still alive, `kill -9 <pid>`
6. Remove log files: `rm -f /tmp/muggle-prepare-*.log`
7. Remove the tracking file: `rm -f /tmp/muggle-test-prepare.json`

Report:

```
Stopped 3 services:
  backend-api    (PID 12345)
  auth-service   (PID 12346)
  frontend       (PID 12347)
```

## Integration Contract (for other skills)

When `muggle-test`, `muggle-do`, or `muggle-test-feature-local` want to confirm services are ready:

1. **Always invoke `muggle-test-prepare`** before any workflow step that touches a local service. It's idempotent — if everything's already healthy it returns in seconds after the smoke test, and if something's broken it surfaces it before tests waste time running against broken UI.
2. Treat a successful prepare return (tracking file exists, PIDs alive, Step 7 passed) as a fresh guarantee with a short shelf life — re-invoke if more than a few minutes pass before testing actually starts, or if anything in the local environment changed.
3. Never bypass prepare on the assumption that "the user knows their stack is up." That assumption is the whole reason this skill exists.

After a test run completes, the calling skill can invoke cleanup by re-invoking this skill with cleanup intent, or leave services running for the next run (the user chose lifecycle management, not clean-state resets).

## Guardrails

- **Verify first, offer to start second** — always check what's already running before proposing to start anything. If everything is up, just confirm readiness and move on.
- **The user may prefer to start services themselves** — always offer that option. Some developers have their own startup scripts, tmux layouts, or docker-compose setups they'd rather use.
- **Never start a process the user didn't approve** — every command is presented and confirmed before execution.
- **Never read file contents outside confirmed directories** — folder names are discoverable; file contents require explicit user selection.
- **Never leave orphan processes untracked** — every background PID goes into the tracking file.
- **Never kill a process the user started independently** — services marked `external: true` survive cleanup.
- **Never assume start commands** — always verify by checking project indicator files; always confirm with the user.
- **Bail early on non-viable services** — don't attempt to start something the user said can't run locally.
- **Idempotent** — if services are already tracked and alive, offer to keep them rather than double-starting. The Step 7 smoke test still runs against them.
- **Port-listening is never enough** — Step 7 (HTTP + body sniff + log tail) is mandatory for every service before the final readiness report. A service that binds to a port but serves a broken-build page is the exact failure mode this skill exists to catch.
- **Clean restart is the recommended fix** — when Step 7 fails, the diagnose-and-fix loop's first option is always Clean Restart (kill + fresh install + restart + re-verify). Lint/build/missing-deps issues are reliably fixed by nuke-and-reinstall, not by restart alone.
- **Fresh install runs automatically** — Step 5.5 no longer asks. Stale or missing `node_modules/` triggers `npm install` with a notification; the only opt-out is aborting the whole skill.
