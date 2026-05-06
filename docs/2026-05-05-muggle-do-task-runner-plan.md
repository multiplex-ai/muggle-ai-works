# Muggle-Do Task Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `muggle:muggle-do-task` skill that lets users run browser automation tasks with natural language, routed from the existing `muggle-do` skill.

**Architecture:** A single new skill file (`plugin/skills/muggle-do-task/SKILL.md`) instructs Claude to parse the user's prompt, find or create Muggle Test entities (project → use case → test case → script) via MCP tools, write two temp files (ActionScript JSON + mutations JSON), and launch the electron app CLI. The existing `muggle-do` SKILL.md routing is already updated (done during brainstorming).

**Tech Stack:** Claude Code skill (Markdown), Muggle Test MCP tools (`muggle-remote-*`), Bash (temp file I/O + process launch), electron app CLI in `engine` mode.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `plugin/skills/muggle-do-task/SKILL.md` | Full task runner workflow |
| Verify (already updated) | `plugin/skills/muggle-do/SKILL.md` | Routes `task`/`run` intent to `muggle:muggle-do-task` |
| Auto-updated by build | `dist/plugin/skills/muggle-do-task/SKILL.md` | Dist copy (via `npm run build:plugin`) |

---

## Task 1: Create the `muggle-do-task` skill

**Files:**
- Create: `plugin/skills/muggle-do-task/SKILL.md`

- [ ] **Step 1: Create the skill directory and file**

```bash
mkdir "C:\Users\stan4\Github\muggle-ai-works\plugin\skills\muggle-do-task"
```

Then create `plugin/skills/muggle-do-task/SKILL.md` with this exact content:

````markdown
---
name: muggle-do-task
description: Run a browser automation task on a website using natural language. Finds or creates the Muggle Test project, use case, test case, and script, then launches the electron app. Use when the user wants to perform an action on a website (post, fill a form, click through a flow) rather than implement a code change.
---

# Muggle Test Task Runner

Runs a browser automation task described in plain English. Finds or creates the necessary Muggle Test entities automatically, then executes via the electron app with mutation-driven step prediction.

## Step 1 — Parse the prompt

From `$ARGUMENTS`, extract:

- **`domain`** — the target website domain (e.g., `x.com`, `amazon.com`, `localhost:3000`). Normalize: strip `www.`, strip `https://`, lowercase.
- **`useCaseName`** — the core action being performed, stripped of variable content (e.g., `"Publish a post"`, `"Add to cart"`, `"Submit a form"`).
- **`mutations`** — the variable parameters as a `string[]`. Each mutation is a plain-English instruction describing what changes this run (e.g., `["The post content should be 'Hello world'"]`, `["The item to add is 'mechanical keyboard'"]`).

If the prompt is ambiguous and you cannot confidently extract domain + useCaseName, ask one clarifying question before proceeding.

## Step 2 — Find or create Project

Load and call `muggle-remote-project-list`. Scan results for a project whose URL contains `domain` (case-insensitive substring match).

**If found:** use it. Tell the user: `Found project: <name>`.

**If not found:** call `muggle-remote-project-create` with:
- `name`: `<domain>`
- `url`: `https://<domain>`

Tell the user: `Created project: <name>`.

## Step 3 — Find or create Use Case

Load and call `muggle-remote-use-case-list` filtered by `projectId`. Fuzzy-match against `useCaseName`:
- Case-insensitive
- Strip punctuation
- Match if either string is a substring of the other

If multiple candidates, pick the closest. If a match is found, tell the user which one was selected.

**If not found:** call `muggle-remote-use-case-create` with:
- `projectId`: from Step 2
- `name`: `useCaseName`
- `description`: derived from the original prompt

Tell the user: `Created use case: <name>`.

## Step 4 — Find or create Test Case

Load and call `muggle-remote-test-case-list-by-use-case` with `useCaseId`. Take the first active test case.

**If not found:** call `muggle-remote-test-case-create` with:
- `useCaseId`: from Step 3

Tell the user: `Created test case: <id>`.

## Step 5 — Find active Test Script

Load and call `muggle-remote-test-script-list` with `testCaseId`. Take the first script with an active/published status.

**If no active script found:**
1. Load and call `muggle-remote-workflow-start-test-script-generation` with the test case ID.
2. Stop and tell the user:

> No script exists yet for **[useCaseName]**. Muggle Test has started generating one.
> Run `/muggle-do "[original prompt]"` again once generation is complete — check the Muggle Test dashboard for status.

Do not proceed further.

## Step 6 — Fetch Action Script

1. Load and call `muggle-remote-test-script-get` with the script ID from Step 5. Extract `actionScriptId`.
2. Load and call `muggle-remote-action-script-get` with `actionScriptId`. This returns the full `ActionScript` JSON object (with `goal`, `url`, `steps`, etc.) that the electron app reads from disk.

## Step 7 — Write temp files

Use Bash to write both files:

```bash
# Create temp directory (idempotent)
mkdir -p "$env:TEMP/muggle-do"

# Write ActionScript JSON
$actionScript = '<full ActionScript JSON from Step 6>'
$actionScript | Out-File -FilePath "$env:TEMP/muggle-do/script-<testCaseId>.json" -Encoding utf8

# Write mutations JSON array
$mutations = '["mutation string 1", "mutation string 2"]'
$mutations | Out-File -FilePath "$env:TEMP/muggle-do/mutations-<timestamp>.json" -Encoding utf8
```

Substitute real values:
- `<testCaseId>`: the test case ID from Step 4 (stable — same file reused across runs for the same use case)
- `<timestamp>`: current Unix timestamp in milliseconds (unique per run)
- ActionScript JSON: the full object from Step 6, serialized as JSON
- Mutations JSON: the `mutations[]` array from Step 1, serialized as a JSON array of strings

## Step 8 — Locate electron app

Check in order using Bash:

```powershell
# 1. Env override
if ($env:ELECTRON_APP_PATH -and (Test-Path $env:ELECTRON_APP_PATH)) {
  $exePath = $env:ELECTRON_APP_PATH
}
# 2. Downloaded binary
elseif (Test-Path "$env:USERPROFILE\.muggle-ai\electron-app") {
  $version = Get-ChildItem "$env:USERPROFILE\.muggle-ai\electron-app" | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty Name
  $exePath = "$env:USERPROFILE\.muggle-ai\electron-app\$version\MuggleAI.exe"
}
# 3. System install
elseif (Test-Path "$env:LOCALAPPDATA\Programs\MuggleAI\MuggleAI.exe") {
  $exePath = "$env:LOCALAPPDATA\Programs\MuggleAI\MuggleAI.exe"
}
else {
  $exePath = $null
}
```

If `$exePath` is null or the file doesn't exist, stop and tell the user:
> Muggle Test electron app not found. Install it from the Muggle Test dashboard, or set the `ELECTRON_APP_PATH` environment variable to its path.

## Step 9 — Launch

```powershell
& $exePath engine `
  "$env:TEMP\muggle-do\script-<testCaseId>.json" `
  "$env:TEMP\muggle-do\mutations-<timestamp>.json" `
  "$env:USERPROFILE\.muggle-ai\oauth-session.json"
```

Tell the user:
> Running **[useCaseName]** on [domain]. Watch the Muggle Test window — it will execute the task using your mutation parameters.
````

- [ ] **Step 2: Commit the new skill**

```bash
cd C:\Users\stan4\Github\muggle-ai-works
git add plugin/skills/muggle-do-task/SKILL.md
git commit -m "feat: add muggle-do-task skill for NL browser task runner"
```

---

## Task 2: Build and verify dist

**Files:**
- Auto-updated: `dist/plugin/skills/muggle-do-task/SKILL.md`

- [ ] **Step 1: Build plugin**

```bash
cd C:\Users\stan4\Github\muggle-ai-works
npm run build:plugin
```

Expected: exits 0, no errors.

- [ ] **Step 2: Verify dist was created**

```bash
ls dist/plugin/skills/muggle-do-task/
```

Expected output: `SKILL.md`

- [ ] **Step 3: Confirm content matches source**

```bash
diff plugin/skills/muggle-do-task/SKILL.md dist/plugin/skills/muggle-do-task/SKILL.md
```

Expected: no diff.

- [ ] **Step 4: Commit dist**

```bash
git add dist/plugin/skills/muggle-do-task/SKILL.md
git commit -m "build: sync muggle-do-task skill to dist"
```

---

## Task 3: Verify muggle-do routing

**Files:**
- Read: `plugin/skills/muggle-do/SKILL.md`

- [ ] **Step 1: Confirm the routing entry exists**

Read `plugin/skills/muggle-do/SKILL.md` and verify the input routing section contains:

```
- `task "<prompt>"` or `run "<prompt>"` → invoke `muggle:muggle-do-task` ...
```

If it only has intent-based routing (no prefix), confirm it says something like:
```
- Prompt describes acting on a website ... → invoke `muggle:muggle-do-task`
```

If either form is present, the routing is correct — no change needed.

- [ ] **Step 2: Rebuild dist for muggle-do if routing was changed**

Only run this if you changed `plugin/skills/muggle-do/SKILL.md` in Step 1:

```bash
npm run build:plugin
git add plugin/skills/muggle-do/SKILL.md dist/plugin/skills/muggle-do/SKILL.md
git commit -m "fix: update muggle-do routing to reference muggle-do-task"
```

---

## Task 4: Smoke test

- [ ] **Step 1: Open a Claude Code session in any project directory**

- [ ] **Step 2: Invoke the skill via muggle-do**

Type:
```
/muggle-do "Publish a test post on x.com with content 'muggle-do smoke test'"
```

- [ ] **Step 3: Verify routing**

Confirm Claude routes to the task runner (not the dev cycle). It should start parsing for `domain`, `useCaseName`, `mutations` — NOT start asking pre-flight questions about code implementation.

- [ ] **Step 4: Verify entity cascade**

Confirm the skill calls `muggle-remote-project-list`, then proceeds through the cascade. If no x.com project exists, it should attempt to create one.

- [ ] **Step 5: Verify two-phase behavior**

If no active script exists for the test case, confirm the skill calls `muggle-remote-workflow-start-test-script-generation` and exits with the "run again once ready" message.

If a script does exist, confirm it writes two files under `%TEMP%\muggle-do\` and launches the electron app.

---

## Open Questions (verify before/during Task 1)

These are unknowns that the implementer must resolve by reading the actual MCP tool schemas:

1. **`muggle-remote-use-case-create` parameters** — load the tool schema and confirm the exact field names (`projectId`, `name`, `description`) and any required fields.
2. **`muggle-remote-test-case-create` parameters** — same: confirm `useCaseId` is the correct field name.
3. **`muggle-remote-test-script-list` filter** — confirm it accepts `testCaseId` as a filter parameter (not just `useCaseId`).
4. **`muggle-remote-action-script-get` return shape** — confirm it returns the full `ActionScript` object (with `goal`, `url`, `steps[]`) as written to disk, not just a steps array.
5. **`muggle-remote-workflow-start-test-script-generation` parameters** — confirm the exact field name for test case ID.
