# Dev Server Readiness — Two-Stage Probe

Single source of truth for "the dev server is actually ready to receive test traffic." Other skills reference this doc instead of reinventing readiness checks.

## When to use

Any skill that starts a frontend dev server (CRA / `react-scripts`, Vite, Next.js, raw webpack) and then dispatches tests against it. The skill must wait for **both** the port to answer **and** the bundle to be compiled before any subagent runs.

## Why HTTP 200 is not enough

A 200 from the dev server's root URL means the HTTP server is up. It does **not** mean the app is ready:

- **CRA** returns 200 while still showing the in-browser **compiling overlay**. Tests against this state see the overlay instead of the app and report misleading "element not found" failures.
- **Webpack error overlays** also return 200. The HTTP response is fine; the page shows a red compile-error block. Replays running against this don't fail with useful errors — they fail because the app never rendered.
- **Vite and Next.js** start their HTTP layer before bundling finishes; the first 200 may serve a transitional page.

Conclusion: port-up is a necessary condition, not a sufficient one.

## Two-stage readiness

**Stage 1 — Port check.** Poll the root URL until 200:

- Use `curl -sf --max-time 3` so a single hanging request doesn't stall the loop.
- Retry every 3 seconds.
- Cap total wait at 5 minutes; longer than that usually means a compile error, not a slow start.

**Stage 2 — Log check.** Tail the dev-server's captured stdout for a framework-specific "ready" line:

| Framework | Pattern |
|---|---|
| CRA / `react-scripts` | `Compiled successfully` (also `webpack compiled successfully`) |
| Vite | `ready in <N> ms` |
| Next.js | `ready - started server on` / `Ready in` |
| Webpack 5 raw | `compiled successfully` (case-insensitive) |

A combined regex that covers all four: `Compiled successfully|ready in|Ready in|ready - started server`.

## Reading the log

For Stage 2 to be possible, the start command must capture stdout to a file:

- Background the start with `npm start > /tmp/dev-server-<port>.log 2>&1 &` (POSIX) or the PowerShell equivalent that redirects to a file.
- After Stage 1 passes, `grep -E "<ready-pattern>" <log>` to confirm.
- **Before** confirming success, also check for **error patterns** earlier in the log — `Failed to compile`, `Module not found`, `Error:`. If any of those appear, surface the last 20 lines of the log and stop. Don't dispatch tests against a broken bundle; the failures will be wrongly attributed to the test, not the build.

## Webpack error overlay detection (long-lived servers)

For dev servers that stick around across multiple test cycles (rare in a PR loop, common in `muggle-test-feature-local`), the bundle can break **after** an earlier "Compiled successfully":

- A live file edit (e.g., test setup that touches `.env`) can trigger a fresh compile that fails.
- The HTTP response is still 200; the page shows the error overlay.

For long-lived servers, **re-tail the log before each test cycle** and check for `Failed to compile|Module not found` appearing **after** the most recent ready-pattern hit. If found, refuse to dispatch and surface the error.

## Helper snippet

POSIX bash; adapt for PowerShell as needed:

```bash
wait_for_dev_server() {
  local url="$1"
  local log="$2"
  local ready_pattern="${3:-Compiled successfully|ready in|Ready in|ready - started server}"
  local deadline=$(( $(date +%s) + 300 ))

  # Stage 1 — port check
  until curl -sf "$url" -o /dev/null --max-time 3 2>/dev/null; do
    [ "$(date +%s)" -gt "$deadline" ] && {
      echo "Timed out waiting for $url"
      tail -20 "$log"
      return 1
    }
    sleep 3
  done

  # Stage 2 — log check
  if ! grep -qE "$ready_pattern" "$log" 2>/dev/null; then
    echo "Port is up but no ready signal in log. Last 20 lines:"
    tail -20 "$log"
    return 1
  fi

  # Sanity — no later compile error
  if grep -qE "Failed to compile|Module not found" "$log" 2>/dev/null; then
    echo "Compile error detected in log. Last 20 lines:"
    tail -20 "$log"
    return 1
  fi
}
```

Call sites: invoke after the start command is backgrounded, before any subagent or replay dispatch. A non-zero return is a `BLOCKED` verdict for the run (see `failure-mode-handling.md` section F) — don't try to "soft-continue."
