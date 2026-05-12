# Dev Server Readiness

**Goal:** Help any skill or agent (a) detect whether a local dev server is already running, and (b) start one and confirm it's ready to receive queries before issuing them.

**Scope:** Generic guidance for any web dev server (CRA, Vite, Next.js, Webpack, etc.). Nothing in this doc is repo-, framework-version-, port-, or skill-specific — callers layer those details on top.

## Port detection — is a dev server already running?

Common dev ports: `3000 3001 4200 5173 8080`. Callers may add repo-specific ports.

```bash
lsof -iTCP -sTCP:LISTEN -nP | grep -E ':(3000|3001|4200|5173|8080)'
```

Confirm any hit with `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/` — expect 2xx.

## Backend health (when the dev server depends on one)

If the app declares a backend URL in its env file, probe the backend's health endpoint before treating the dev server as usable. 5xx or unreachable → halt; the frontend may render but its data layer is dead, so any query against it is meaningless.

## Two-stage readiness — after starting a dev server

Port-up is necessary but not sufficient: CRA returns 200 while the compiling overlay is showing; Vite and Next.js start the HTTP layer before bundling finishes. Wait for **both** the port to answer and the bundle to be compiled before issuing queries.

**Stage 1 — Port check.** Poll the root URL until 200 with `curl -sf --max-time 3`, retry every 3 s, cap at 5 min.

**Stage 2 — Log check.** Tail the dev-server's captured stdout for a framework-specific ready line:

| Framework | Pattern |
|---|---|
| CRA / `react-scripts` | `Compiled successfully` (or `webpack compiled successfully`) |
| Vite | `ready in <N> ms` |
| Next.js | `ready - started server on` / `Ready in` |
| Webpack 5 raw | `compiled successfully` (case-insensitive) |

Combined regex: `Compiled successfully|ready in|Ready in|ready - started server`.

Before declaring ready, check the log for `Failed to compile`, `Module not found`, `Error:` — if any appears, surface the last 20 lines of the log and halt. Don't issue queries against a broken bundle.

For long-lived servers, re-tail the log before each cycle and check for compile errors appearing **after** the most recent ready-pattern hit.

## Reading the log

Start command must capture stdout: `npm start > /tmp/dev-server-<port>.log 2>&1 &` (POSIX) or the PowerShell equivalent.

## Helper snippet (POSIX bash)

```bash
wait_for_dev_server() {
  local url="$1"
  local log="$2"
  local ready_pattern="${3:-Compiled successfully|ready in|Ready in|ready - started server}"
  local deadline=$(( $(date +%s) + 300 ))

  until curl -sf "$url" -o /dev/null --max-time 3 2>/dev/null; do
    [ "$(date +%s)" -gt "$deadline" ] && { tail -20 "$log"; return 1; }
    sleep 3
  done

  grep -qE "$ready_pattern" "$log" 2>/dev/null || { tail -20 "$log"; return 1; }
  grep -qE "Failed to compile|Module not found" "$log" 2>/dev/null && { tail -20 "$log"; return 1; }
}
```

A non-zero return means the server failed to come up — callers decide how to surface (skill-specific verdict / blocked state).
