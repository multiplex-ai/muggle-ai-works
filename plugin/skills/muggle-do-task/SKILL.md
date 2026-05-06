---
name: muggle-do-task
description: Run a browser automation task on a website using natural language. Finds or creates the Muggle Test project, use case, test case, and script, then launches the electron app. Use when the user wants to perform an action on a website (post, fill a form, click through a flow) rather than implement a code change.
---

# Muggle Test Task Runner

Runs a browser automation task described in plain English. Finds or creates the necessary Muggle Test entities automatically, then executes via the electron app with mutation-driven step prediction.

## Step 1 — Parse the prompt

From `$ARGUMENTS`, extract:

- **`domain`** — the target website domain (e.g., `x.com`, `amazon.com`, `localhost:3000`). Normalize: strip `www.`, strip `https://`, lowercase. The result should be a bare domain like `x.com` or `localhost:3000` — no scheme, no trailing slash.
- **`useCaseName`** — the core action being performed, stripped of variable content (e.g., `"Publish a post"`, `"Add to cart"`, `"Submit a form"`).
- **`mutations`** — the variable parameters as a `string[]`. Each mutation is a plain-English instruction describing what changes this run (e.g., `["The post content should be 'Hello world'"]`, `["The item to add is 'mechanical keyboard'"]`).

If the prompt is ambiguous and you cannot confidently extract domain + useCaseName, ask one clarifying question before proceeding.

## Step 2 — Find or create Project

Load and call `muggle-remote-project-list`. Scan results for a project whose URL contains `domain` (case-insensitive substring match).

**If found:** use it. Tell the user: `Found project: <name>`.

**If not found:** call `muggle-remote-project-create` with:
- `projectName`: `<domain>`
- `description`: `E2E acceptance testing project for <domain>`
- `url`: `https://<domain>`

Tell the user: `Created project: <name>`.

## Step 3 — Find or create Use Case

Load and call `muggle-remote-use-case-list` filtered by `projectId`. Fuzzy-match against `useCaseName`:
- Case-insensitive
- Strip punctuation
- Match if either string is a substring of the other

If multiple candidates, pick the closest. If a match is found, tell the user which one was selected.

**If not found:** call `muggle-remote-use-case-create-from-prompts` with:
- `projectId`: from Step 2
- `instructions`: `["<original prompt>"]`

This returns the created use case(s). Use the first result. If the result is empty or the call fails, stop and tell the user: "Could not create use case — try rephrasing the task description."

Tell the user: `Created use case: <title>`.

## Step 4 — Find or create Test Case

Load and call `muggle-remote-test-case-list-by-use-case` with `useCaseId`. Filter for test cases where `status` equals `ACTIVE`. If none are active, create a new one.

**If not found:** call `muggle-remote-test-case-create` with:
- `projectId`: from Step 2
- `useCaseId`: from Step 3
- `title`: `<useCaseName>`
- `description`: `Test case for: <original prompt>`
- `goal`: `Successfully complete: <useCaseName>`
- `expectedResult`: `The action completes without error`
- `url`: `https://<domain>`

Tell the user: `Created test case: <id>`.

## Step 5 — Find active Test Script

Load and call `muggle-remote-test-script-list` with:
- `projectId`: from Step 2
- `testCaseId`: from Step 4

Filter for scripts where `status` equals `ACTIVE` or `PUBLISHED`. If all returned scripts have a different status (e.g., `DRAFT`, `GENERATION_PENDING`, `FAILED`), treat this as "no active script found" and proceed to generation.

**If no active script found:**
1. Load and call `muggle-remote-workflow-start-test-script-generation` with:
   - `projectId`: from Step 2
   - `useCaseId`: from Step 3
   - `testCaseId`: from Step 4
   - `name`: `Generate script for: <useCaseName>`
   - `url`: `https://<domain>`
   - `goal`: `Successfully complete: <useCaseName>`
   - `precondition`: `User is on <domain>`
   - `instructions`: `Complete the following task: <useCaseName>`
   - `expectedResult`: `The action completes without error`
2. Stop and tell the user:

> No script exists yet for **[useCaseName]**. Muggle Test has started generating one.
> Run `/muggle-do "[original prompt]"` again once generation is complete — check the Muggle Test dashboard for status.

Do not proceed further.

## Step 6 — Fetch Action Script

1. Load and call `muggle-remote-test-script-get` with `testScriptId` from Step 5. Extract `actionScriptId` from the response. If `actionScriptId` is missing or null, stop and tell the user: "The script record is incomplete — it may still be generating. Try again in a moment."
2. Load and call `muggle-remote-action-script-get` with `actionScriptId`. This returns the full `ActionScript` JSON object (with `goal`, `url`, `steps`, etc.) that the electron app reads from disk.

Tell the user: `Preparing script file...`

## Step 7 — Write temp files

Use PowerShell (via Bash tool) to write both files:

```powershell
New-Item -ItemType Directory -Force -Path "$env:TEMP\muggle-do" | Out-Null

$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$scriptPath = "$env:TEMP\muggle-do\script-<testCaseId>.json"
$mutationsPath = "$env:TEMP\muggle-do\mutations-$timestamp.json"

$actionScriptJson = '<ActionScript object from Step 6, serialized via ConvertTo-Json -Depth 20>'
$actionScriptJson | Out-File -FilePath $scriptPath -Encoding utf8NoBOM

$mutationsJson = '<mutations[] from Step 1, serialized via ConvertTo-Json>'
$mutationsJson | Out-File -FilePath $mutationsPath -Encoding utf8NoBOM
```

Substitute real values:
- `<testCaseId>`: test case ID from Step 4 (stable — same file reused for the same use case)
- ActionScript JSON: the full object from Step 6, serialized as JSON
- Mutations JSON: the `mutations[]` array from Step 1, serialized as JSON array of strings

Use PowerShell `ConvertTo-Json` to serialize objects to JSON strings before assigning to variables. Do not embed raw JSON with curly braces directly in single-quoted strings.

## Step 8 — Locate electron app

Run this PowerShell block via Bash to find the exe:

```powershell
$exePath = $null
if ($env:ELECTRON_APP_PATH -and (Test-Path $env:ELECTRON_APP_PATH)) {
  $exePath = $env:ELECTRON_APP_PATH
} elseif (Test-Path "$env:USERPROFILE\.muggle-ai\electron-app") {
  $version = Get-ChildItem "$env:USERPROFILE\.muggle-ai\electron-app" | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty Name
  $candidate = "$env:USERPROFILE\.muggle-ai\electron-app\$version\MuggleAI.exe"
  if (Test-Path $candidate) { $exePath = $candidate }
} elseif (Test-Path "$env:LOCALAPPDATA\Programs\MuggleAI\MuggleAI.exe") {
  $exePath = "$env:LOCALAPPDATA\Programs\MuggleAI\MuggleAI.exe"
}
$exePath
```

If the output is empty or the path doesn't exist, stop and tell the user:
> Muggle Test electron app not found. Install it from the Muggle Test dashboard, or set `ELECTRON_APP_PATH` to its full path.

Capture the last line of output — that is `<exePath>`. Use it in Step 9.

## Step 9 — Launch

```powershell
& "<exePath>" engine $scriptPath $mutationsPath "$env:USERPROFILE\.muggle-ai\oauth-session.json"
```

Always double-quote `<exePath>` when substituting — paths containing spaces (e.g., a username with a space) will silently fail without quotes.

Tell the user:
> Running **[useCaseName]** on [domain]. Watch the Muggle Test window — it will execute the task using your mutation parameters.
