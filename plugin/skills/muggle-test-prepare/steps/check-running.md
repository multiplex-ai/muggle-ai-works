# Check what's already running

## Resolve the target host first

The dev-server URL the tests will hit is a **recorded value, not a guess** — resolve it before probing anything.

1. Read the cached host with `muggle-local-last-host-get`. It reads the entry keyed on `<cwd>` in `~/.muggle-ai/last-host.json`; a worktree usually has **no cache of its own**, so when the worktree returns nothing, pass the **main** working-tree root as `cwd` — `git rev-parse --git-common-dir`, then its parent directory.
2. Apply the [`autoSelectLocalHost`](../../muggle-preferences/preference-gates/autoSelectLocalHost.md) gate (read its value from the `Muggle Test Preferences` session-context line, which carries every key already resolved):
   - `always` **and** a cache exists → use it silently: `Using saved local URL {lastHost}`.
   - otherwise (`ask` / `never`, or no cache) → **confirm before using any host.** Run the gate's Picker 1 with `{lastHost}` (cached URL, omitted when absent) and `{suggestedHost}` (a port you actually detect listening). Never auto-pick, and never fall back to a framework default like `:3000`; if nothing is cached or detected, ask the user to type the URL.

The resolved host fixes the **expected** dev-server port for the detection below — probe that port; don't infer the target from whichever port happens to be listening.

## Detect listening services

Run port detection and (when an app declares a backend URL) backend-health probe per [`../../_shared/dev-server-readiness.md`](../../_shared/dev-server-readiness.md).

## Prove what each listener serves

A port that answers proves nothing about which code answers it — a peer session's dev server, or last week's, answers just as well. Judge every listener on a service's port against the tracking files ([PID Tracking](../SKILL.md#pid-tracking)) and the service's run directory and commit from [resolve-sources](./resolve-sources.md):

| Listener | Verdict |
| :------- | :------ |
| A tracking entry with this port, a live PID, `dir` = the run directory and `headSha` = the commit it must serve | **Proven** — keep it. A base-checkout service a peer started is proven the same way, and shared |
| The plan marks the service `external: true` | **Vouched** — the user confirmed in Decide that they run it from this checkout; keep it, never kill it |
| Tracked under the run directory's checkout at an older `headSha` | **Stale** — restart it per [start-services](./start-services.md) |
| Tracked under a different checkout, PID alive, and the plan marks the port `restart` from [claim-stack](./claim-stack.md) | **Released** — no session's lease needs it any more; restart it from the run directory per [start-services](./start-services.md) |
| Tracked under a different checkout, PID alive | **A peer's** — never test against it, never kill it; [Port already held](#port-already-held) |
| Untracked | **Unknown code** — when the plan approves a restart for this service, treat it as stale: Clean Restart it through [smoke-test](./smoke-test.md)'s loop (kill → [fresh-install](./fresh-install.md) → [start-services](./start-services.md) → re-test). Otherwise [Port already held](#port-already-held) |

An approved restart settles whose port it is. When the restart cannot free or claim the port — the old process survives the kill, or the port keeps answering with code this run did not start — the service is broken, not contested: it stays in the smoke-test loop and ends `DEGRADED` with that diagnosis, never `needs-input`. `DEGRADED` already stops the caller from testing, so nothing foreign is ever reported `READY`. [Port already held](#port-already-held) is only for a peer's service, or for unknown code the plan gives no restart approval for.

> "**backend-api** on port 3001 (PID 54321) serves `api/.claude/worktrees/base-main` @ `a1b2c3d` — proven."

If **all** required services are proven or vouched, skip straight to [smoke-test](./smoke-test.md) — don't trust port-listening alone.

Otherwise continue to [start-commands](./start-commands.md) only for the services still missing. **Exception:** when this stage is entered via the [reuse-plan](./reuse-plan.md) short-circuit, the missing entries already carry their `command` from the reused plan — skip `start-commands` and go straight to [env-file](./env-file.md).

## Port already held

When a port the run needs is held by a process this run may not touch — a peer's service, or unknown code with no restart approved:

The held process is likely something the user — or a parallel session — is still using. Don't auto-decide. In the agent, return `needs-input:` naming the port, the PID, and the checkout its tracking entry names (or "untracked"); the skill asks:

The held process is likely something the user is still using — a current test or dev server they value more than this prepare run. Don't auto-decide; leave the kill-vs-pause call to them.

> "Port 3999 is held by PID 87421, serving `app/.claude/worktrees/feat-y` — not this change's code. How do you want to proceed?"

- Option 1: "Use the next available port" (recommended — non-destructive, leaves the existing process running)
- Option 2: "Force-kill PID 87421 and claim port 3999" (kill-switch — only if nobody needs that process)
- Option 3: "Pause — leave it running, I'll finish up and re-run prepare later"
- Option 4: "It's mine — I started it from `<run directory>`" (untracked listeners only) → mark the service `external: true` in the plan and record the listener in the run directory's tracking file at its current HEAD

Testing against a listener nobody can tie to this change's checkout is never an option: its results describe someone else's code.

**Option 1**: probe `3999 + N` for `N = 1, 2, …` until nothing listens. Record the new port and any env file edit (`PORT=` in `.env.local` etc.). Dev server may need restart to pick up.

**Option 2 — force-kill (destructive):**
- **Windows PowerShell:** `Get-NetTCPConnection -LocalPort <port> -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch { } }`
- **POSIX:** `lsof -ti:<port> 2>/dev/null | xargs -r kill -9`

Re-verify the port is free before continuing.
