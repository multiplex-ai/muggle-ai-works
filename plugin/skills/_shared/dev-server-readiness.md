# Dev Server Readiness

**Goal:** Help any skill or agent (a) detect whether a local development server is already running, and (b) start one and confirm it is ready to receive requests before issuing them.

**Scope:** Generic guidance for any local development server. This document is OS-agnostic, programming-language-agnostic, and framework-agnostic. Nothing here is repo-, toolchain-, runtime-, port-, or skill-specific. Callers provide concrete details.

**How to read this doc:** The core algorithm is platform-neutral. The OS-specific commands below are examples you can copy directly or adapt.

## Port detection — is a dev server already running?

Common dev ports: `3000 3001 4200 5173 8080`. Callers may add repo-specific ports.

Use any local networking utility available on the current OS to check whether one of the expected ports is listening.

For each listening candidate, probe its base URL and verify it returns a successful status code (typically `2xx`).

### Examples by OS

#### Linux / macOS (bash/zsh)

```bash
# Detect listeners on common dev ports
lsof -iTCP -sTCP:LISTEN -nP | grep -E ':(3000|3001|4200|5173|8080)\b'

# Probe one candidate URL (returns HTTP status code)
curl -sS -o /dev/null -w "%{http_code}" "http://localhost:3000/"
```

#### Windows PowerShell

```powershell
# Detect listeners on common dev ports
Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in 3000,3001,4200,5173,8080 } |
  Select-Object -Property LocalAddress, LocalPort, OwningProcess

# Probe one candidate URL (shows status code)
(Invoke-WebRequest -Uri "http://localhost:3000/" -Method Get -TimeoutSec 3).StatusCode
```

#### Windows CMD

```bat
:: Detect listeners on common dev ports
netstat -ano | findstr /R /C:":3000 " /C:":3001 " /C:":4200 " /C:":5173 " /C:":8080 "
```

## Backend health (when the dev server depends on one)

If the app declares a backend URL in its env file, probe the backend's health endpoint before treating the dev server as usable. 5xx or unreachable → halt; the frontend may render but its data layer is dead, so any query against it is meaningless.

## Body sniff patterns

A `200 OK` can still be a build-error overlay or stack trace. Search the response body (case-insensitive) for broken-build markers — a match means unhealthy regardless of status.

| Source | Pattern (regex) |
|:-------|:----------------|
| Next.js | `__next_error__\|Failed to compile\|webpack-internal://` |
| Vite | `vite-error-overlay\|Internal server error\|\[plugin:` |
| Node | `MODULE_NOT_FOUND\|Cannot find module\|npm ERR!` |
| Express/Node | `Cannot GET /\|Cannot POST /\|Error: ENOENT\|EACCES\|EADDRINUSE` |
| Stack trace | `at .*\(.*\.[jt]sx?:\d+:\d+\)` |

#### bash/zsh

```bash
BODY=$(curl -sS -L --max-redirs 1 --max-time 3 "$URL")
PATTERN='__next_error__|Failed to compile|webpack-internal://|vite-error-overlay|Internal server error|MODULE_NOT_FOUND|Cannot find module|Cannot GET /|npm ERR!|Error: ENOENT|EACCES|EADDRINUSE|at .*\(.*\.[jt]sx?:[0-9]+:[0-9]+\)'
echo "$BODY" | grep -qiE "$PATTERN" && { echo "BODY-SNIFF FAIL"; echo "$BODY" | grep -iE "$PATTERN" | head -3; exit 1; }
```

#### PowerShell

```powershell
$body = (Invoke-WebRequest -Uri $url -TimeoutSec 3 -MaximumRedirection 1 -ErrorAction Stop).Content
$pattern = '__next_error__|Failed to compile|webpack-internal://|vite-error-overlay|Internal server error|MODULE_NOT_FOUND|Cannot find module|Cannot GET /|npm ERR!|Error: ENOENT|EACCES|EADDRINUSE|at .*\(.*\.[jt]sx?:\d+:\d+\)'
if ($body -imatch $pattern) { Write-Host "BODY-SNIFF FAIL"; [regex]::Matches($body, $pattern, 'IgnoreCase') | Select-Object -First 3 | ForEach-Object { $_.Value }; exit 1 }
```

## Two-stage readiness — after starting a dev server

Network reachability is necessary but not sufficient. Many dev servers bind to a port before build/startup work is complete. Wait for **both** network readiness and application readiness before issuing requests.

**Stage 1 — Network check.** Poll the target URL until it responds successfully. Use a short request timeout, a fixed retry interval (for example, every 3 seconds), and a hard overall timeout (for example, 5 minutes).

**Stage 2 — Startup completion check.** Inspect captured process output for a known "ready" signal defined by the caller.

The caller should provide:
- a ready pattern (for example, `ready`, `started`, `listening`, `compiled successfully`)
- one or more failure patterns (for example, `failed`, `error`, `module not found`, `unable to`)
- the number of trailing log lines to surface on failure

Before declaring ready, check for failure patterns in logs. If present, surface the trailing log lines and halt. Do not issue requests against a broken startup.

For long-lived servers, re-check logs before each execution cycle and fail if new errors appear after the latest ready signal.

## Reading the log

The server start command must capture process output to a retrievable location (file, buffer, or managed process stream). Implementation details are environment-specific and should be supplied by the caller.

### Start command examples by OS

#### Linux / macOS (bash/zsh)

```bash
# Start in background and capture logs
npm start > "/tmp/dev-server-3000.log" 2>&1 &
```

#### Windows PowerShell

```powershell
# Start detached and capture both stdout/stderr
Start-Process -FilePath "npm" -ArgumentList "start" `
  -RedirectStandardOutput "$env:TEMP\dev-server-3000.log" `
  -RedirectStandardError "$env:TEMP\dev-server-3000.log"
```

#### Windows CMD

```bat
:: Start in background and capture logs
start "" cmd /c "npm start > "%TEMP%\dev-server-3000.log" 2>&1"
```

## Generic algorithm (pseudocode)

```text
FUNCTION wait_for_dev_server(input):
  REQUIRE input.url
  REQUIRE input.logSource
  REQUIRE input.readyPattern
  REQUIRE input.failurePatterns
  REQUIRE input.requestTimeoutSeconds
  REQUIRE input.retryIntervalSeconds
  REQUIRE input.maxWaitSeconds
  REQUIRE input.failureTailLineCount

  deadline = now() + input.maxWaitSeconds

  WHILE now() <= deadline:
    responseOk = probe_url(
      url = input.url,
      timeoutSeconds = input.requestTimeoutSeconds
    )
    IF responseOk:
      BREAK
    sleep(input.retryIntervalSeconds)

  IF now() > deadline:
    RETURN failure_with_log_tail(input.logSource, input.failureTailLineCount)

  logText = read_log(input.logSource)

  IF contains_any(logText, input.failurePatterns):
    RETURN failure_with_log_tail(input.logSource, input.failureTailLineCount)

  IF NOT contains(logText, input.readyPattern):
    RETURN failure_with_log_tail(input.logSource, input.failureTailLineCount)

  RETURN success
```

A failure result means the server is not ready. Callers decide how to surface the blocked state.

## Practical implementation notes (important)

- Prefer polling both conditions until deadline (network responds **and** ready pattern appears), instead of checking logs only once.
- Avoid stale-log false positives by recording a start marker (timestamp, byte offset, or unique token) and scanning only new log content.
- When checking for failure after ready, evaluate failures that appear **after** the latest ready signal.
- If your app redirects `/` (for example to auth), treat expected `3xx` as acceptable in Stage 1.

## End-to-end examples by OS (drop-in scripts)

### Linux / macOS (bash/zsh)

```bash
URL="http://localhost:3000/"
LOG="/tmp/dev-server-3000.log"
READY_PATTERN='Compiled successfully|ready in|Ready in|ready - started server|listening'
FAIL_PATTERN='Failed to compile|Module not found|Error:|EADDRINUSE|ERR!'
DEADLINE=$(( $(date +%s) + 300 ))

npm start > "$LOG" 2>&1 &
START_LINE=$(wc -l < "$LOG" 2>/dev/null || echo 0)

while [ "$(date +%s)" -le "$DEADLINE" ]; do
  STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "$URL" || echo 000)
  NEW_LOG=$(tail -n +"$((START_LINE + 1))" "$LOG" 2>/dev/null)

  if echo "$NEW_LOG" | grep -qE "$FAIL_PATTERN"; then
    tail -20 "$LOG"
    exit 1
  fi

  if [ "$STATUS" -ge 200 ] && [ "$STATUS" -lt 400 ] && echo "$NEW_LOG" | grep -qiE "$READY_PATTERN"; then
    echo "Server ready"
    exit 0
  fi

  sleep 3
done

tail -20 "$LOG"
exit 1
```

### Windows PowerShell

```powershell
$url = "http://localhost:3000/"
$log = Join-Path $env:TEMP "dev-server-3000.log"
$readyPattern = "Compiled successfully|ready in|Ready in|ready - started server|listening"
$failPattern = "Failed to compile|Module not found|Error:|EADDRINUSE|ERR!"
$deadline = (Get-Date).AddMinutes(5)

if (Test-Path $log) {
  $startLine = (Get-Content $log | Measure-Object -Line).Lines
} else {
  $startLine = 0
}

Start-Process -FilePath "npm" -ArgumentList "start" `
  -RedirectStandardOutput $log `
  -RedirectStandardError $log

while ((Get-Date) -le $deadline) {
  $status = 0
  try {
    $response = Invoke-WebRequest -Uri $url -Method Get -TimeoutSec 3 -MaximumRedirection 0 -ErrorAction Stop
    $status = [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $status = [int]$_.Exception.Response.StatusCode
    } else {
      $status = 0
    }
  }

  $allLines = if (Test-Path $log) { Get-Content $log } else { @() }
  $newLines = if ($allLines.Count -gt $startLine) { $allLines[$startLine..($allLines.Count - 1)] } else { @() }
  $newLog = ($newLines -join "`n")

  if ($newLog -match $failPattern) {
    Get-Content $log -Tail 20
    exit 1
  }

  if ($status -ge 200 -and $status -lt 400 -and $newLog -match $readyPattern) {
    Write-Host "Server ready"
    exit 0
  }

  Start-Sleep -Seconds 3
}

Get-Content $log -Tail 20
exit 1
```
