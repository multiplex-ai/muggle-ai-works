---
name: muggle-do-task
description: Run a browser automation task on a website using natural language. Finds or creates the Muggle Test project, use case, test case, and script, then executes locally via the electron app. Use when the user wants to perform an action on a website (post, fill a form, click through a flow) rather than implement a code change.
---

# Muggle Test Task Runner

Runs a browser automation task described in plain English. Finds or creates the necessary Muggle Test entities automatically, then executes locally with mutation-driven step prediction.

## Step 1 — Parse the prompt

From `$ARGUMENTS`, extract:

- **`domain`** — the target website domain (e.g., `x.com`, `amazon.com`, `localhost:3000`). Normalize: strip `www.`, strip `https://`, lowercase. Result: bare domain with no scheme, no trailing slash.
- **`useCaseName`** — the core action being performed, stripped of variable content (e.g., `"Publish a post"`, `"Add to cart"`, `"Submit a form"`).
- **`mutations`** — variable parameters as a `string[]` (JSON array of strings). Each string is either:
  - A plain-English instruction describing what varies this run (e.g., `"The post content should be 'Hello world'"`)
  - A local file path for uploads (e.g., `"Attach the image at C:\\Users\\stan4\\Pictures\\photo.jpg"`)
  
  Examples: `["The post content should be 'Hello world'"]`, `["Attach the image at C:\\Users\\stan4\\photo.jpg", "Caption should be 'My photo'"]`
- **`localUrl`** — the full URL to test against (e.g., `https://x.com`, `http://localhost:3000`). For external sites, use `https://<domain>`. For local dev servers, use the port the user's app is running on.

If the prompt is ambiguous and you cannot confidently extract these, ask one clarifying question before proceeding.

## Step 2 — Find or create Project

Load and call `muggle-remote-project-list`. Find a project whose URL contains `domain` (case-insensitive substring match).

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

If multiple candidates, pick the closest and tell the user which was selected.

**If not found:** call `muggle-remote-use-case-create-from-prompts` with:
- `projectId`: from Step 2
- `instructions`: `["<original prompt>"]`

Use the first result. Capture its `id` as `useCaseId`. If the result is empty or the call fails, stop and tell the user: "Could not create use case — try rephrasing the task description."

Tell the user: `Created use case: <title>`.

## Step 4 — Find or create Test Case

Load and call `muggle-remote-test-case-list-by-use-case` with `useCaseId`. Filter for test cases where `status` equals `ACTIVE`.

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

Tell the user which mutations will be applied: `Mutations: <mutations[]>` (or "no mutations" if empty).

Filter for scripts where `status` equals `ACTIVE` or `PUBLISHED`. If all returned scripts have another status (`DRAFT`, `GENERATION_PENDING`, `FAILED`), treat as "no active script" and proceed to Phase 1.

---

### Phase 1 — No active script: generate locally

1. Load and call `muggle-remote-test-case-get` with the test case ID from Step 4. This returns the full test case object needed by the local execution tool.

2. Load and call `muggle-local-execute-test-generation` with:
   - `testCase`: the full object from step 1 above
   - `localUrl`: from Step 1
   - `mutations`: the `mutations[]` array from Step 1 (omit if empty)

3. Tell the user:
> Script generation is running in the Muggle Test window. Once complete, run `/muggle-do "<original prompt>"` again to execute the task.

Do not proceed further.

---

### Phase 2 — Active script found: replay with mutations

## Step 6 — Fetch Action Script

1. Load and call `muggle-remote-test-script-get` with the script ID from Step 5. Extract `actionScriptId`. If `actionScriptId` is missing or null, stop and tell the user: "The script record is incomplete — it may still be generating. Try again in a moment."

2. Load and call `muggle-remote-action-script-get` with `actionScriptId`.

Tell the user: `Executing task...`

## Step 7 — Execute locally

Load and call `muggle-local-execute-replay` with:
- `testScript`: the full object from Step 6 (from `muggle-remote-test-script-get`)
- `actionScript`: the content from Step 6 (from `muggle-remote-action-script-get`)
- `localUrl`: from Step 1
- `mutations`: the `mutations[]` array from Step 1 (omit if empty)

Tell the user:
> Running **[useCaseName]** on [domain]. Watch the Muggle Test window — it will execute the task with your parameters applied.
