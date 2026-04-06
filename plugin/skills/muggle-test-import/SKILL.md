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

Confirm the final file list using numbered choice:

```
Files to import:
──────────────────────────────────────────────────────────────
- e2e/auth.spec.ts
- e2e/cart.spec.ts
- e2e/checkout.spec.ts
──────────────────────────────────────────────────────────────
1. Yes, analyse these files
2. No, let me change the selection
──────────────────────────────────────────────────────────────
```

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

Ask for confirmation using numbered choices:

```
Does this structure look right?
──────────────────────────────────────────────────────────────
1. Yes, proceed to import
2. No, I want to make changes
──────────────────────────────────────────────────────────────
```

If user selects 2, ask what they want to change and incorporate feedback. Then confirm again with the same numbered prompt.

> For Path A (native PRD upload): present the use case/test case list that Muggle extracted
> after the processing workflow completes, and ask the user to confirm before adding any
> extra test cases manually.

---

## Step 4 — Authenticate

Call `muggle-remote-auth-status` first.

If already authenticated → skip to Step 5.

If not authenticated:
1. Tell the user a browser window is about to open.
2. Call `muggle-remote-auth-login` (opens browser automatically).
3. Tell the user to complete login in the browser.
4. If the call returns before the user finishes, call `muggle-remote-auth-poll` to wait for completion.

---

## Step 5 — Pick or create a project

Call `muggle-remote-project-list` and show the results as a numbered menu:

```
Select a project:
──────────────────────────────────────────────────────────────
1. Acme Web App
2. Admin Portal
3. Mobile API
4. Create new project
──────────────────────────────────────────────────────────────
```

Ask: "Reply with the number."

**If user selects "Create new project"**, propose values based on what you learned from the source files:
- **Name**: infer the app name from filenames, URLs, or document headings (e.g., "Acme App")
- **Description**: "Imported from [filename(s)] — [date]"
- **URL**: the base URL of the app under test

Show the proposal and confirm using numbered choice:

```
Create project with these settings?
  Name: [proposed name]
  Description: [proposed description]
  URL: [proposed URL]
──────────────────────────────────────────────────────────────
1. Yes, create it
2. No, let me change something
──────────────────────────────────────────────────────────────
```

Only call `muggle-remote-project-create` after user selects 1.

---

## Step 6 — Import

Import in two passes. Show progress to the user as you go.

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

### Pass 1 — Create use cases (Path B only)

Call `muggle-remote-use-case-create-from-prompts` with all use cases in a single batch:

```
projectId: <chosen project ID>
prompts: [
  { instruction: "<Use case name> — <one-sentence description of what this use case covers>" },
  ...
]
```

After the call returns, collect the use case IDs from the response.
If IDs are not in the response, call `muggle-remote-use-case-list` and match by name.

### Pass 2 — Create test cases

For each use case, call `muggle-remote-test-case-create` for every test case under it:

```
projectId: <project ID>
useCaseId: <use case ID>
title:          "Login with valid credentials"
description:    "Navigate to the login page, enter a valid email and password, submit the form"
goal:           "Verify that a registered user can log in successfully"
expectedResult: "User is redirected to the dashboard and sees their name in the header"
precondition:   "A user account exists and is not locked"
priority:       "HIGH"
url:            "https://app.example.com/login"
```

Print progress: `Creating test cases for "User Authentication"... (1/3)`

It is safe to create test cases for different use cases in parallel — do so when you have many to create.

---

## Step 7 — Summary

When all imports are done, print a clean summary. Include:
- The project name
- Total use cases and test cases created
- A line per use case with its test case count and a link to view it
- A link to the project overview

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
