---
name: muggle-test-feature-local
description: Run a real-browser end-to-end (E2E) acceptance test against localhost to verify a feature works correctly — signup flows, checkout, form validation, UI interactions, or any user-facing behavior. Launches a browser that executes test steps and captures screenshots. Use this skill whenever the user asks to test, validate, or verify their web app, UI changes, user flows, or frontend behavior on localhost or a dev server — even if they don't mention 'muggle' or 'E2E' explicitly.
---

# Muggle Test Feature Local

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-test-feature-local"`.

**Goal:** Run or generate an end-to-end test against a **local URL** using Muggle Test's Electron browser.

| Scope | MCP tools |
| :---- | :-------- |
| Cloud (projects, cases, scripts, auth) | `muggle-remote-*` |
| Local (Electron run, publish, results) | `muggle-local-*` |
| Create new entities (preview / create) | `muggle-remote-project-create`, `muggle-remote-use-case-prompt-preview`, `muggle-remote-use-case-create-from-prompts`, `muggle-remote-test-case-generate-from-prompt`, `muggle-remote-test-case-create` |

The local URL only changes where the browser opens; it does not change the remote project or test definitions.

## Branch hygiene

Three gates apply, each per the standard procedure in [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md):

- `autoUseWorktree` at pre-flight (see [`_shared/use-worktrees.md`](../_shared/use-worktrees.md)).
- `autoRebase` before Step 7 (Execute) when `behind > 0` (see [`_shared/rebase-before-e2e.md`](../_shared/rebase-before-e2e.md)).
- `autoCleanup` after the PR is merged (see [`_shared/post-merge-cleanup.md`](../_shared/post-merge-cleanup.md)).

## Local environment prerequisites

Before any workflow step, invoke [`muggle-test-prepare`](../muggle-test-prepare/SKILL.md). Halt on what it surfaces.

## UX Guidelines — Minimize Typing

**Every selection-based question MUST use the `AskUserQuestion` tool** (or the platform's equivalent structured selection tool). Never ask the user to "reply with a number" in a plain text message — always present clickable options.

- **Selections** (project, use case, test case, script): Use `AskUserQuestion` with labeled options the user can click.
- **Free-text inputs** (URLs, descriptions): Only use plain text prompts when there is no finite set of options. Even then, offer a detected/default value when possible.

## Preferences

Gates run per `preference-gates/README.md`.

| Preference | Step | Decision it gates |
|------------|------|-------------------|
| `autoLogin` | 1 | Reuse saved credentials when auth is required |
| `autoSelectProject` | 2 | Reuse last-used Muggle Test project for this repo |
| `autoSelectLocalHost` | 4 | Reuse last-used local dev server URL for this repo |
| `autoUseWorktree` | 0 (pre-flight) | Isolate dev work in a worktree (see [`_shared/use-worktrees.md`](../_shared/use-worktrees.md)) |
| `autoRebase` | 0 (pre-flight) | Rebase onto `origin/<default>` before Step 7 (Execute) (see [`_shared/rebase-before-e2e.md`](../_shared/rebase-before-e2e.md)) |
| `showElectronBrowser` | 7 | Show Electron browser window during local E2E tests |
| `openTestResultsAfterRun` | 8 | Open results page on Muggle Test dashboard after run |
| `postPRVisualWalkthrough` | 10 | Post visual walkthrough to PR after results |
| `autoCreatePR` | 10 (if no PR) | Auto-create the PR when posting the walkthrough has no PR to target |
| `autoWatchPR` | 10.5 (if a PR exists) | Start a `muggle-pr-followup` watcher on the PR after the run |
| `autoCleanup` | post-merge | Run cleanup after the PR for this work is merged (see [`_shared/post-merge-cleanup.md`](../_shared/post-merge-cleanup.md)) |

## Workflow

### 1. Auth (gated by `autoLogin`)

- `muggle-remote-auth-status`
- If **authenticated**: gate `autoLogin` (per `preference-gates/README.md`):
  - `always` → proceed with saved session.
  - `never` → `muggle-remote-auth-login` with `forceNewSession: true`, then `muggle-remote-auth-poll`.
  - `ask` → run Picker 1 from `preference-gates/autoLogin.md` via `AskUserQuestion`; map the answer back to one of the actions above.
- If **not signed in or expired**: call `muggle-remote-auth-login` then `muggle-remote-auth-poll`. Do not skip or assume auth.

### 2. Targets (user must confirm)

The per-repo project cache lives at `<cwd>/.muggle-ai/last-project.json` (via the `muggle-local-last-project-get` / `muggle-local-last-project-set` MCP tools). Look for `Muggle Test Last Project: id=… url=… name="…"` in session context.

Gate `autoSelectProject` (per `preference-gates/README.md`). Cache: `Muggle Test Last Project` session line.
- `always` + cache → use cached `projectId`, skip to use case selection. No cache → fall through to `ask`.
- `never` → full project list; skip Picker 2.
- `ask` → project list picker (see gate file for spec + Picker 2 override). Skip Picker 2 if "Create new project".

Ask the user to pick **project**, **use case**, and **test case** (do not infer).

- `muggle-remote-project-list`
- `muggle-remote-use-case-list` (with `projectId`)
- `muggle-remote-test-case-list-by-use-case` (with `useCaseId`)

**Selection UI (mandatory):** Every selection MUST use `AskUserQuestion` with clickable options. Never ask the user to "reply with the number" in plain text.

**Project selection context:** A **project** groups all your test results, use cases, and test scripts on the Muggle AI dashboard. Include the project URL in each option label so the user can identify the right one.

Prompt for projects: "Pick the project to group this test into:"

**Relevance-first filtering (mandatory for project, use case, and test case lists):**

- Do **not** dump the full list by default.
- Rank items by semantic relevance to the user's stated goal (title first, then description / user story / acceptance criteria).
- Show only the **top 3-5** most relevant options via `AskUserQuestion`, plus these fixed tail options:
  - **"Show full list"** — present the complete list in a new `AskUserQuestion` call. **Skip this option** if the API returned zero rows.
  - **"Create new ..."** — never omitted. Label per step: "Create new project", "Create new use case", or "Create new test case".

**Create new — tools and flow (use these MCP tools; preview before persist):**

- **Project — Create new project:** Collect `projectName`, `description`, and `url` (may be the local app URL, e.g. `http://localhost:3999`). Call `muggle-remote-project-create`. Use the returned `projectId` and continue.
- **Use case — Create new use case:** User provides a natural-language instruction (or you reuse their testing goal).
  1. `muggle-remote-use-case-prompt-preview` with `projectId`, `instruction` — show preview; get confirmation via `AskUserQuestion`.
  2. `muggle-remote-use-case-create-from-prompts` with `projectId` and `instructions: ["<the user's natural-language instruction>"]` — persist. Use the created use case id and continue to test-case selection.
- **Test case — Create new test case** (requires a chosen `useCaseId`): User provides an instruction describing what to test.
  1. `muggle-remote-test-case-generate-from-prompt` with `projectId`, `useCaseId`, `instruction` — **preview only** (server test-case prompt preview); show the returned draft(s); get confirmation via `AskUserQuestion`.
  2. Persist the accepted draft with `muggle-remote-test-case-create`, mapping preview fields into the required properties (`title`, `description`, `goal`, `expectedResult`, `url`, etc.). Then continue from **section 5** with that `testCaseId`.

### 3. Ensure Local Services Are Ready

Before detecting the local URL, verify that the services the user needs are actually running. Use the `muggle:muggle-test-prepare` integration contract:

1. Check if `/tmp/muggle-test-prepare.json` exists.
2. If it exists, verify tracked PIDs are alive with `kill -0`.
3. If all live → services are ready, proceed to Step 4 (Local URL).
4. If the file is missing or has stale PIDs → invoke the `muggle:muggle-test-prepare` skill via the `Skill` tool to get services started. Once it completes, proceed to Step 4.

This step is especially important when the user's app depends on sibling services (a backend API, an auth service, etc.) that may not be running yet. The prepare skill handles discovery, startup, and cleanup so this skill doesn't have to.

**Compile-gate (do not skip)** — after `muggle-test-prepare` reports ready, run the two-stage readiness probe per [`_shared/dev-server-readiness.md`](../_shared/dev-server-readiness.md) before dispatching any test. Halt on any failure it surfaces; do not dispatch against a broken bundle.

### 4. Local URL (gated by `autoSelectLocalHost`)

Skill responsibilities (the rest is in `preference-gates/autoSelectLocalHost.md`):
- **Read the cache**: `Muggle Test Last Host: <url>` session-context line, or `muggle-local-last-host-get`. Pass as `{lastHost}` substitution.
- **Auto-detect a suggested URL**: `lsof -iTCP -sTCP:LISTEN -nP | grep -E ':(3000|3001|4200|5173|8080)'`. Pass as `{suggestedHost}`.
- **Save the cache**: call `muggle-local-last-host-set` after the user picks (the gate file requires this on every pick).

Gate `autoSelectLocalHost` per `preference-gates/README.md` + `preference-gates/autoSelectLocalHost.md`.

Remind them: local URL is only the execution target, not tied to cloud project config.

### 4a. Satisfy the test case chain (prerequisite parents)

Before deciding the target's script, resolve its prerequisite chain from the backend test-plan graph and ensure every ancestor already has a ready script — generating any that don't, **test-generation only**, root-first. Follow [`_shared/test-case-chain-readiness.md`](../_shared/test-case-chain-readiness.md).

`muggle-remote-test-case-ancestors-get` returns the chain; an `orphan` test case has no prerequisites — skip straight to Step 5. Do **not** infer parents from `precondition` text; the graph is authoritative.

### 5. Existing scripts vs new generation

`muggle-remote-test-script-list` with `testCaseId`.

- **If any replayable/succeeded scripts exist:** use `AskUserQuestion` to present them as clickable options. Show: name, created/updated, step count per option. Include **"Generate new script"** as the last option.
- **If none:** go straight to generation (no need to ask replay vs generate).

### 6. Load data for the chosen path

Run the shared loop in [`../_shared/e2e-run.md`](../_shared/e2e-run.md): [`freshSession`](../_shared/e2e-run.md#fresh-session), [replay vs regen](../_shared/e2e-run.md#the-loop), [`actionScript` as-is](../_shared/e2e-run.md#action-script), [`timeoutMs`](../_shared/e2e-run.md#timeouts), and [failure interpretation](../_shared/e2e-run.md#failure-interpretation).

Caller glue: `mode` is the path chosen in §5; `localUrl` from §4; `cwd` = the repo root, or the prepared worktree when one is in use.

### 7. Execute (no approval prompt; `showUi` gated by `showElectronBrowser`)

Call `muggle-local-execute-test-generation` or `muggle-local-execute-replay` directly. **Do not** ask the user to re-approve the Electron launch — the user choosing this skill in the first place is the approval.

Gate `showElectronBrowser` (per `preference-gates/README.md`). Reuse choice within a session.
- `always` → omit `showUi`.
- `never` → pass `showUi: false`.
- `ask` → run Picker 1 from `preference-gates/showElectronBrowser.md` via `AskUserQuestion`; map the answer back to one of the actions above.

### 8. Upload run to cloud (every completed run; open `viewUrl` gated by `openTestResultsAfterRun`)

Upload pass-or-fail. Failed runs still need cloud-hosted screenshots and per-step actions for the PR walkthrough — without them reviewers see only a generic "failed" link. The `status` field in the upload payload tells the backend whether to promote the run's action script as the test case's canonical replay script (passed → promote; failed → record only).

- Publish per [`../_shared/e2e-run.md#publish`](../_shared/e2e-run.md#publish) — includes the zero-step `muggle-remote-local-run-upload` fallback.
- Gate `openTestResultsAfterRun` (per `preference-gates/README.md`):
  - `always` → open `viewUrl` automatically (`open "<viewUrl>"` on macOS or OS equivalent).
  - `never` → print the URL only.
  - `ask` → run Picker 1 from `preference-gates/openTestResultsAfterRun.md` via `AskUserQuestion`; map the answer back to one of the actions above.

### 9. Report

Read the run record per [`../_shared/e2e-run.md#run-result`](../_shared/e2e-run.md#run-result) and [failure interpretation](../_shared/e2e-run.md#failure-interpretation) — never diagnose from `execute`'s stdout tail.

- Include in the report: status, duration, pass/fail summary, per-step summary (passed runs), artifact paths, errors if failed, and script view URL when publishing ran.

### 9a. Route failures through the failure-mode handler

If the run's status is `failed` or any non-passing terminal state, follow [`_shared/failure-mode-handling.md`](../_shared/failure-mode-handling.md):

- **Replay-mode run failed** (the user picked an existing script in Step 5) → section B (buckets: `infra` / `stale-script` / `product-defect`).
- **Regen-mode run failed** (the user picked "Generate new script" or no script existed) → section C (buckets: `transient` / `infra` / `agent-course` / `product-uxux`).

Steps:
1. Read the run via `muggle-local-run-result-get` and extract signals per the heuristics in the shared doc.
2. Emit `replay-failure-classified` or `regen-failure-classified` via `muggle-local-telemetry-event-emit` **before** asking the user.
3. Present the recommended action via `AskUserQuestion` with the alternatives the shared doc lists for that bucket.
4. After the user picks, emit the matching `*-resolved` event with `userAction`.

If the user picks `muggle-feedback` from any bucket's options, invoke the `muggle-feedback` skill via the `Skill` tool, passing the just-finished `runId` so the submit flow opens with this run preloaded.

Skip silently when the run passed cleanly — failure-mode events are by definition about failures.

### 9b. Remind the user to guide the agent (every Electron invocation)

Fires after **every** Electron run, pass or fail. A run can technically pass while still containing steps the user would correct — a misclick, wrong element, or a summary that doesn't match intent. This is the user's chance to flag it before regeneration picks up elsewhere.

**Skip if 9a already routed the user into `muggle-feedback` for this run.** Otherwise ask via `AskUserQuestion`:

> "Did the agent miss or do anything wrong on this run? Your feedback regenerates the affected scripts."

- **Yes — give feedback** → invoke `muggle-feedback` via the `Skill` tool, passing the just-finished `runId` so the submit flow opens on this run's steps and summary.
- **No — looks good** → continue to Step 10.

Non-blocking — one click to dismiss. Do not re-ask for the same `runId` within a session.

### 10. Offer to post a visual walkthrough to the PR

After reporting results:

1. Fire [`postPRVisualWalkthrough`](../muggle-preferences/preference-gates/postPRVisualWalkthrough.md). On skip → 10.5.
2. `gh pr view --json number,title,url 2>/dev/null` — find the PR.
3. If no PR: fire [`autoCreatePR`](../muggle-preferences/preference-gates/autoCreatePR.md). On skip → 10.5.
4. Assemble the `E2eReport` — see [`../muggle-pr-visual-walkthrough/e2e-report-assembly.md`](../muggle-pr-visual-walkthrough/e2e-report-assembly.md).
5. Invoke [`../muggle-pr-visual-walkthrough/SKILL.md`](../muggle-pr-visual-walkthrough/SKILL.md) Mode A with the `E2eReport`.

### 10.5. Offer to watch the PR for review follow-ups

Once a PR exists for this work, offer to keep watching its review thread.

1. Identify the PR — reuse the `gh pr view --json number,title,url` result from section 10 if available, else run it now. No PR (none exists, none created) → end.
2. Fire [`autoWatchPR`](../muggle-preferences/preference-gates/autoWatchPR.md) with `{pr}` = `<owner>/<repo>#<number>`. On skip → end.
3. On proceed: start the watcher reusing this run's context so it never re-prompts —
   - Seed the `muggle-pr-followup` session slot and dispatch its loop per the stage-8 seeding in [`../do/open-prs/forward.md`](../do/open-prs/forward.md) (default slug `<repo>-pr<number>`).
   - Additionally write `state.md`'s `## Pre-flight answers` block from the context resolved this run — validation strategy, local URL, project, credentials, auth, working tree — per [`../_shared/resolve-e2e-validation-context.md`](../_shared/resolve-e2e-validation-context.md#persisted-fields). Strategy = `local-e2e` for this local E2E run.

The `/mprfollowup` shortcut starts the same watcher manually at any time.

## Non-negotiables

- No silent auth skip.
- **Never prompt for Electron launch approval** before execution — invoking this skill is the approval. Just run.
- **Never diagnose a failed run from `execute`'s response stdout tail.** Always call `muggle-local-run-result-get` first; classify only from its structured fields and (when present) the artifacts it names. The execute tail is an excerpt and routinely truncates the failure cause.
- Satisfy the prerequisite chain (Step 4a) before generating or replaying the target. Read it from `muggle-remote-test-case-ancestors-get` — never infer parents from `precondition` text. Generate any not-ready ancestor test-generation-only, root-first.
- If replayable scripts exist, do not default to generation without user choice.
- No hiding failures: surface errors and artifact paths.
- **Always offer the agent-guidance reminder after every Electron run** (Step 9b) — pass or fail — unless 9a already routed the user into `muggle-feedback`. Never silently end a run without giving the user a one-click path to flag what was wrong.
- Replay/timeout discipline per [`../_shared/e2e-run.md`](../_shared/e2e-run.md) — never hand-build `actionScript`; always pass `timeoutMs`.
- Use `AskUserQuestion` for every selection — project, use case, test case, script. Never ask the user to type a number.
- Project, use case, and test case selection lists must always include "Create new ...". Include "Show full list" whenever the API returned at least one row for that step; omit "Show full list" when the list is empty (offer "Create new ..." only). For creates, use preview tools (`muggle-remote-use-case-prompt-preview`, `muggle-remote-test-case-generate-from-prompt`) before persisting.
- PR posting is always optional and always delegated to the `muggle:muggle-pr-visual-walkthrough` skill — never inline the walkthrough markdown or call `gh pr comment` directly from this skill.
