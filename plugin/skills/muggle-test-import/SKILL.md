---
name: muggle-test-import
description: >
  Bring existing tests and test artifacts INTO Muggle Test — from Playwright, Cypress, PRDs,
  Gherkin feature files, test plan docs, Notion exports, or any source.
  TRIGGER when: user wants to import/migrate/load/upload/add/convert existing test files or
  test docs into Muggle — e.g. "import my playwright tests", "migrate from cypress to muggle",
  "upload my PRD to muggle", "add my e2e specs to our muggle project", "load these test cases
  into muggle", "turn this feature file into muggle test cases", "create muggle test cases from
  my PRD", "track my specs in muggle", or any .spec.ts/.cy.js/.feature/.md file + muggle.
  DO NOT TRIGGER when: user wants to run/replay Muggle scripts, scan a site, generate new
  tests from scratch, or check existing test results.
---

# Muggle Test Import

This skill migrates existing test artifacts into Muggle Test. It reads your source files,
structures them into use cases and test cases, gets your approval, then creates everything
in a Muggle project via the API.

## Preferences

Gates run per `preference-gates/GATE.md`.

| Preference | Step | Decision it gates |
|------------|------|-------------------|
| `autoLogin` | 4 | Reuse saved credentials when auth is required |
| `autoSelectProject` | 5 | Reuse last-used Muggle project for this repo |
| `suggestRelatedUseCases` | 8a | Suggest related use cases after import |
| `suggestRelatedTestCases` | 8b | Suggest related test cases after import |

## Concepts

- **Use case**: A high-level feature or user workflow (e.g., "User Registration", "Checkout Flow")
- **Test case**: A specific scenario within a use case (e.g., "Register with invalid email", "Complete checkout with Visa card")

---

## Step 1 — Identify source files

Ask the user which files to analyse. Accept glob patterns, directory paths, or individual files. Common sources:

| Source type | Typical patterns |
|---|---|
| Playwright | `**/*.spec.ts`, `**/*.test.ts`, `e2e/**` |
| Cypress | `**/*.cy.js`, `**/*.cy.ts`, `cypress/integration/**` |
| PRD / design doc | `*.md`, `*.txt`, `docs/**` |
| Other | Any file the user points to |

If the user is vague, scan the current directory for test file patterns and show what you found.

Also ask for the **base URL of the app under test** if it is not embedded in the source files — you will need it for every test case.

Confirm the final file list before reading.

---

## Step 2 — Analyse and extract structure

The extraction strategy depends on the file type. Choose the right path before reading.

### Path A — PRD / design documents (preferred for document sources)

Muggle has a native PRD processing workflow that extracts use cases more accurately than
manual parsing. Use this path for `.md`, `.txt`, `.pdf`, or any prose document.

After authentication and project selection (Steps 4–5), come back and:
1. Read the file and base64-encode its content
2. Call `muggle-remote-prd-file-upload` with the encoded content and filename
3. Call `muggle-remote-workflow-start-prd-file-process` using the fields returned by the upload
   (`prdFilePath`, `contentChecksum`, `fileSize`) plus the project URL
4. Poll `muggle-remote-wf-get-prd-process-latest-run` until the status is complete
5. After processing, call `muggle-remote-use-case-list` to retrieve the created use cases and
   their IDs — then skip Step 6 Pass 1 (use cases are already created) and go straight to
   creating any additional test cases if needed

> Note: base64-encode in-memory using a Bash one-liner or Python — do not modify the file.

If the native workflow fails or the document is in a format it cannot parse, fall back to
Path B (manual extraction).

### Path B — Code-based test files (Playwright, Cypress, etc.)

Read each file and extract a **use case → test case** hierarchy manually.

- `describe()` / `test.describe()` block → use case name
- `it()` / `test()` block → test case
- Pull `page.goto('...')` calls for the URL
- Derive `goal` and `expectedResult` from assertion text and comments

### Path B — General rules (applies to manual extraction)
- Group thematically related tests under one use case when there is no explicit `describe()` grouping
- Never leave `goal` or `expectedResult` blank — infer them from context
- Assign priority: `HIGH` for critical paths and error handling, `MEDIUM` for secondary flows, `LOW` for edge cases

Build an internal model before presenting anything to the user (Path B only):

```
Use Case: <Name>
  - TC1: <title> | goal | expectedResult | precondition | priority | url
  - TC2: ...
```

---

## Step 3 — Review with user

Present the extracted structure clearly. Example format:

```
Found 3 use cases with 8 test cases:

1. User Authentication  (3 test cases)
   ✦ [HIGH]   Login with valid credentials
   ✦ [HIGH]   Login with wrong password shows error
   ✦ [MEDIUM] Forgot password flow sends reset email

2. Shopping Cart  (3 test cases)
   ✦ [HIGH]   Add item to cart
   ✦ [MEDIUM] Remove item from cart
   ✦ [LOW]    Cart persists after page reload

3. Checkout  (2 test cases)
   ✦ [HIGH]   Complete checkout with credit card
   ✦ [HIGH]   Checkout fails with invalid payment info
```

Use `AskQuestion` to confirm:
- "Looks good — proceed with import"
- "I want to make changes first"

If the user wants changes, incorporate feedback, then ask again. Only proceed after explicit approval.

> For Path A (native PRD upload): present the use case/test case list that Muggle extracted
> after the processing workflow completes, and ask the user to confirm before adding any
> extra test cases manually.

---

## Step 4 — Authenticate (gated by `autoLogin`)

Call `muggle-remote-auth-status` first.

If **already authenticated** → gate `autoLogin` (per `preference-gates/GATE.md`):
- Pro-action: skip to Step 5.
- Skip-action: `muggle-remote-auth-login` with `forceNewSession: true`, then `muggle-remote-auth-poll`.

If **not authenticated**:
1. Tell the user a browser window is about to open.
2. Call `muggle-remote-auth-login` (opens browser automatically).
3. Tell the user to complete login in the browser.
4. If the call returns before the user finishes, call `muggle-remote-auth-poll` to wait for completion.

---

## Step 5 — Pick or create a project (gated by `autoSelectProject`)

A **project** is where all your imported use cases, test cases, and future test results are grouped on the Muggle AI dashboard.

The per-repo project cache lives at `<cwd>/.muggle-ai/last-project.json` (via the `muggle-local-last-project-get` / `muggle-local-last-project-set` MCP tools). Look for `Muggle Last Project: id=… url=… name="…"` in session context.

Gate `autoSelectProject` (per `preference-gates/GATE.md`). Cache: `Muggle Last Project` session line.
- `always` + cache → use cached `projectId`, skip to Step 6. No cache → fall through to `ask`.
- `never` → full project list; skip Picker 2.
- `ask` → project list picker (see gate file for spec + Picker 2 override). Skip Picker 2 if "Create new project".

### Logic

1. Call `muggle-remote-project-list` (only when not satisfied by the `always` cache).
2. Use `AskQuestion` to present all projects as clickable options. Include the project URL in each label. Always include a "Create new project" option at the end.

   Prompt: `"Pick the project to import into:"`

3. **If creating a new project**, propose values based on what you learned from the source files:
   - **Name**: infer the app name from filenames, URLs, or document headings (e.g., "Acme App")
   - **Description**: "Imported from [filename(s)] — [date]"
   - **URL**: the base URL of the app under test

   Show the proposal and confirm before calling `muggle-remote-project-create`.

---

## Step 6 — Import

Import in two passes using bulk-preview. Show progress to the user as you go.

Both passes use Muggle's async bulk-preview MCP tools, which route prompts through OpenAI's
Batch API for roughly ~50% of normal LLM cost. The flow is always: **submit → poll → persist**.

### Path A — Native PRD upload (for document files)

If the source is a PRD or design document, use Muggle's built-in processing pipeline:

1. Read the file and base64-encode its content:
   ```bash
   base64 -i /path/to/doc.md
   ```
2. Call `muggle-remote-prd-file-upload`:
   ```
   projectId: <chosen project ID>
   fileName:  "checkout-prd.md"
   contentBase64: "<base64 string>"
   contentType: "text/markdown"
   ```
3. Call `muggle-remote-workflow-start-prd-file-process` using all fields returned by the upload:
   ```
   projectId: <project ID>
   name: "Import from checkout-prd.md"
   description: "Auto-extract use cases from PRD"
   prdFilePath: <from upload response>
   originalFileName: "checkout-prd.md"
   url: <app base URL>
   contentChecksum: <from upload response>
   fileSize: <from upload response>
   ```
4. Poll `muggle-remote-wf-get-prd-process-latest-run` every 5 seconds until status is complete.
5. Call `muggle-remote-use-case-list` to retrieve the created use cases and their IDs.
6. Present the extracted use cases to the user for review (Step 3), then skip Pass 1 below and
   go directly to Pass 2 if additional test cases are needed.

If the upload or processing fails, fall back to Path B manual extraction.

### Path B — Manual import (for code-based test files)

Run both passes below for Playwright, Cypress, or other test scripts.

### Shared limits (both passes)

- Maximum 100 prompts per submit call. If you have more, split into batches of 100 and submit sequentially.
- Maximum 4000 characters per `instruction`.
- Maximum 3 in-flight bulk-preview jobs per project (the submit tool will error if exceeded).

### Shared error handling (both passes)

The bulk-preview submit and get/cancel MCP tools surface structured error codes — look for
these on any tool result and act accordingly:

| Error code / symptom | What happened | What to do |
|---|---|---|
| `TOO_MANY_IN_FLIGHT_JOBS` (HTTP 429) | Already 3 in-flight jobs for this project | Tell the user: "There are already 3 bulk-preview jobs in progress for this project. Wait for them to finish, then retry." Stop. |
| `QUOTA_EXCEEDED_PREFLIGHT` (HTTP 409) | Batch would blow past the account's quota for this resource | Show: "Your quota allows at most `<maxPromptsAllowed>` prompts in this batch (current headroom: `<headroom>`). Please reduce the batch and try again." Stop. |
| `NOT_FOUND` on submit (HTTP 404) | Project or parent use case does not exist, or this server version doesn't expose bulk-preview yet | Tell the user which — double-check the IDs you passed. If you're confident the IDs are right, ask the user to make sure the prompt-service is up to date. Stop. |
| `VALIDATION_ERROR` (HTTP 400) | A prompt exceeds limits (e.g. >4000 chars) or the prompt list is empty | Fix the offending prompts and retry. |
| Payload > 1 MB (HTTP 413) | Body too large | Split into smaller batches. |

### Shared polling loop

After a successful submit, poll with `muggle-remote-bulk-preview-job-get` (inputs: `projectId`,
`jobId`) every 15 seconds. Show progress like:
```
Generating previews for "User Authentication"... (status: running, elapsed: 30s)
```

`status` values and what to do:

| Status | Terminal? | Action |
|---|---|---|
| `queued` | No | Keep polling |
| `submitted` | No | Keep polling |
| `running` | No | Keep polling |
| `succeeded` | Yes | All prompts processed — proceed to persist results |
| `partial` | Yes | Some prompts succeeded — show summary, ask user whether to proceed |
| `failed` | Yes | Job failed entirely — show `error.message` and stop |
| `cancelled` | Yes | Job was cancelled — stop |
| `expired` | Yes | Job expired before completing — tell user to retry |

**If status is `partial`**, show:
```
Preview completed with partial results: <N> of <promptCount> generated successfully.

Failed items:
  - [<clientRef>] "<source text>": <error message>

Proceed with the <N> successful items, or cancel to review?
```
Use `AskQuestion` with options "Proceed with successful items" / "Cancel import". Only continue
if the user chooses to proceed.

If you need to abort an in-flight job, call `muggle-remote-bulk-preview-job-cancel` — the
server picks up the request cooperatively within one harvester tick.

### Pass 1 — Create use cases (Path B only)

1. Call `muggle-remote-use-case-bulk-preview-submit` with one prompt per use case:
   ```
   projectId: <chosen project ID>
   prompts: [
     { clientRef: "uc-0", instruction: "<Use case name> — <one-sentence description>" },
     ...
   ]
   ```
   The call returns `{ jobId, status, kind, promptCount }`.

2. Run the **Shared polling loop** above until the job reaches a terminal status.

3. For each successful result (shape: `{ clientRef, index, status: "success", useCase: IUseCaseCreationRequest }`),
   call `muggle-remote-use-case-create` to persist it — no LLM is invoked, so this is fast and free:
   ```
   projectId:        <project ID>
   title:            <from useCase.title>
   description:      <from useCase.description>
   userStory:        <from useCase.userStory>
   url:              <from useCase.url>         # optional
   useCaseBreakdown: <from useCase.useCaseBreakdown>
   status:           <from useCase.status>       # e.g. DRAFT
   priority:         <from useCase.priority>     # e.g. MEDIUM
   source:           <from useCase.source>       # e.g. PROMPT
   category:         <from useCase.category>     # optional
   ```

4. Collect the returned `useCaseId` of each created use case — you'll need it for Pass 2.
   It is safe to persist use cases in parallel once the job is terminal.

### Pass 2 — Generate and create test cases

For each use case, run a bulk-preview job to generate its test cases.

1. Call `muggle-remote-test-case-bulk-preview-submit`:
   ```
   projectId: <project ID>
   useCaseId: <use case ID>
   prompts: [
     {
       clientRef: "tc-0",
       instruction: "<title> | goal: <goal> | expectedResult: <expectedResult> | precondition: <precondition> | priority: <HIGH|MEDIUM|LOW> | url: <url>"
     },
     ...
   ]
   ```

2. Run the **Shared polling loop** above until the job reaches a terminal status.

3. Each successful result has this shape (note the fan-out):
   ```jsonc
   { "clientRef": "tc-0", "index": 0, "status": "success", "testCases": [ /* ITestCaseCreationRequest[] — fan-out 1–5 */ ] }
   ```
   One input prompt may produce 1–5 test case items. For each item in `result.testCases`, call
   `muggle-remote-test-case-create`:
   ```
   projectId:      <project ID>
   useCaseId:      <use case ID>
   title:          <from testCase.title>
   description:    <from testCase.description>
   goal:           <from testCase.goal>
   expectedResult: <from testCase.expectedResult>
   precondition:   <from testCase.precondition>
   priority:       <from testCase.priority>
   url:            <from testCase.url>
   ```

Print progress: `Creating test cases for "User Authentication"... (1/3)`

It is safe to create test cases for different use cases in parallel once their bulk-preview
jobs have reached a terminal status. However, **submit** bulk-preview jobs sequentially to
avoid exceeding the 3 in-flight job cap per project.

---

## Step 7 — Summary

When all imports are done, print a clean summary. Include:
- The project name
- Total use cases and test cases created
- A line per use case with its test case count and a link to view it
- A link to the project overview
- If any items failed during preview (partial status), list them so the user can retry

Construct view URLs using the Muggle dashboard URL pattern:
- Project test cases: `https://www.muggle-ai.com/muggleTestV0/dashboard/projects/<projectId>/testcases`
- Use case within project: `https://www.muggle-ai.com/muggleTestV0/dashboard/projects/<projectId>/testcases?useCaseId=<useCaseId>`

Example:

```
✅ Import complete!

Project:  Acme App
  → https://www.muggle-ai.com/muggleTestV0/dashboard/projects/proj_abc123/testcases
Source:   e2e/auth.spec.ts, e2e/cart.spec.ts

Imported: 3 use cases · 8 test cases

  1. User Authentication  (3 test cases)
     → https://www.muggle-ai.com/muggleTestV0/dashboard/projects/proj_abc123/testcases?useCaseId=uc_111

  2. Shopping Cart  (3 test cases)
     → https://www.muggle-ai.com/muggleTestV0/dashboard/projects/proj_abc123/testcases?useCaseId=uc_222

  3. Checkout  (2 test cases)
     → https://www.muggle-ai.com/muggleTestV0/dashboard/projects/proj_abc123/testcases?useCaseId=uc_333

Next step: run /muggle:do to generate executable browser test scripts for these test cases.
```

### Step 8 — Optional follow-up suggestions

Two preferences gate optional follow-ups: `suggestRelatedUseCases` and `suggestRelatedTestCases`. Both are independent — handle each in turn.

#### 8a — Related use cases (gated by `suggestRelatedUseCases`)

The query is: "from the use cases already in this project, which ones are *not* in the import set but look related to it?" — surface them so the user can decide whether their import missed something the project already tracks.

Gate `suggestRelatedUseCases` (per `preference-gates/GATE.md`):
- Pro-action: run the query below.
- Skip-action: skip.

When running the query:
1. Call `muggle-remote-use-case-list` for the project.
2. Filter out any use case whose `useCaseId` is in the set you just imported in Step 6 (Pass 1).
3. Rank the remainder by semantic relevance to the imported titles/descriptions (substring overlap, shared keywords — best-effort, no LLM call needed).
4. Present the top 3-5 via `AskQuestion` with `allow_multiple: true`. Label each with `<title> — <one-line description>`.
5. For any the user selects, prompt to add follow-up test cases (treat each as a Pass 2 invocation: `muggle-remote-test-case-bulk-preview-submit` → poll → persist via `muggle-remote-test-case-create`).
6. If the filtered list is empty (the import covers everything in the project), say so and skip.

#### 8b — Related test cases (gated by `suggestRelatedTestCases`)

For each use case the user just created, surface other test cases already attached that the import didn't add — same idea, scoped to a single use case.

Gate `suggestRelatedTestCases` (per `preference-gates/GATE.md`):
- Pro-action: run the query below.
- Skip-action: skip.

When running the query, for each use case in the import:
1. Call `muggle-remote-test-case-list-by-use-case` with that `useCaseId`.
2. Filter out any test case you just created in Pass 2 of Step 6.
3. Present the remainder via `AskQuestion` with `allow_multiple: true`, labeled `[<priority>] <title> — <goal>`.
4. For any the user selects: nothing to create (they already exist) — just confirm to the user that those tests are now part of their Muggle project alongside the imported ones.
5. If a use case has no extra test cases, skip it silently.
