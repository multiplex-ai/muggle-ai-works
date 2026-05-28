# Check what's already running

Run port detection and (when an app declares a backend URL) backend-health probe per [`../../_shared/dev-server-readiness.md`](../../_shared/dev-server-readiness.md). Cross-reference hits against selected service directories.

> "**backend-api** is already listening on port 3001 (PID 54321) — looks good."

If **all** required services are running, skip straight to [smoke-test](./smoke-test.md) — don't trust port-listening alone.

If some are running, acknowledge and continue to [start-commands](./start-commands.md) only for the missing ones. **Exception:** when this stage is entered via the [reuse-plan](./reuse-plan.md) short-circuit, the missing entries already have their `command` populated in `/tmp/muggle-test-prepare.json` from the reused plan — skip `start-commands` and go straight to [env-file](./env-file.md). For already-running services:
- Option 1: "It's fine, keep it"
- Option 2: "Restart it"

Mark kept services as `external: true` in the tracking file so cleanup leaves them alone.

## Port already held

When the user wants a port held by a process they did **not** select (typically a stale dev server from a sibling worktree):

> "Port 3999 is held by PID 87421 (you didn't select this process). How do you want to proceed?"

- Option 1: "Use the next available port" (recommended — non-destructive)
- Option 2: "Force-kill PID 87421 and claim port 3999"
- Option 3: "Abort"

**Option 1**: probe `3999 + N` for `N = 1, 2, …` until nothing listens. Record the new port and any env file edit (`PORT=` in `.env.local` etc.). Dev server may need restart to pick up.

**Option 2 — force-kill (destructive):**
- **Windows PowerShell:** `Get-NetTCPConnection -LocalPort <port> -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch { } }`
- **POSIX:** `lsof -ti:<port> 2>/dev/null | xargs -r kill -9`

Re-verify the port is free before continuing.
