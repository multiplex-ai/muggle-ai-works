---
name: muggle-test-regenerate-missing
description: "Bulk-regenerate test scripts for every test case in a Muggle AI project that doesn't currently have an active script. Scans the project, finds test cases stuck in DRAFT or GENERATION_PENDING (no usable script attached), shows the user the list, and on approval kicks off bulk remote test script generation via the Muggle cloud. Use this skill whenever the user asks to 'regenerate missing scripts', 'fill in missing test scripts', 'generate scripts for test cases without one', 'regen all the test cases that don't have scripts', 'rebuild scripts for stale test cases', 'fix test cases with no script', 'bulk regenerate', or any phrasing that means 'kick off script generation across a project for the cases that need it'. Triggers on: 'regenerate missing test scripts', 'generate scripts for all empty test cases', 'fill the gaps in my test scripts', 'bulk test script regen', 'all my test cases without active scripts'. This is the go-to skill for project-wide script catch-up — it handles discovery, filtering, confirmation, and remote workflow dispatch end-to-end."
---

# Muggle Test — Regenerate Missing Test Scripts

A bulk maintenance skill for Muggle AI projects. It finds every test case in a project that does **not** currently have an active (ready-to-run) test script, shows the list to the user, and on approval triggers a remote test script generation workflow for each one. Useful after creating a batch of new test cases or when cleaning up a project that has drifted.

Execution is **remote only** — Muggle's cloud generates the scripts in parallel against the project URL. The user's machine is not involved beyond making API calls.

## Preferences

Gates run per `preference-gates/GATE.md`.

| Preference | Step | Decision it gates |
|------------|------|-------------------|
| `autoLogin` | 1 | Reuse saved credentials when auth is required |
| `autoSelectProject` | 2 | Reuse last-used Muggle project for this repo |

## Concept: what counts as "no active script"

In the Muggle data model, a test case carries a status that reflects whether it has a usable script attached:

| Status | Meaning | Regenerate? |
|:-------|:--------|:-----------:|
| `ACTIVE` | Has a generated, ready-to-run script | No — already good |
| `DRAFT` | Created but never generated | **Yes** |
| `GENERATION_PENDING` | Queued but generation never started | **Yes** |
| `GENERATING` | Currently generating | No — generation is in flight; don't double-dispatch |
| `REPLAY_PENDING` / `REPLAYING` | A replay is in flight; script exists | No — busy with replay |
| `DEPRECATED` | Marked stale on purpose | No — user decision |
| `ARCHIVED` | Hidden from normal flows | No — user decision |

The skill targets exactly **DRAFT** and **GENERATION_PENDING** by default. These are the two states that mean "no usable script attached and nothing running to produce one." `GENERATING` is deliberately excluded — a workflow is already in progress, and firing a second one races against the first and wastes budget.

Treat this filter as a default, not a law. If the user explicitly says "include generating ones too, they're stuck" or "include deprecated", respect the override — but don't widen the filter on your own.

## UX Guidelines — Minimize Typing

**Every selection-based question MUST use the `AskQuestion` tool** (or the platform's equivalent structured selection tool). Never ask the user to "reply with a number" — always present clickable options.

- **Selections** (project, which test cases to include): Use `AskQuestion`, with `allow_multiple: true` for the test case picker.
- **Free-text inputs** (project URL when creating, override filters): Only ask as plain text when the option set isn't finite.
- **Batch related questions** when independent. Don't ask sequentially what could be one screen.

## Workflow

### Step 1 — Authenticate (gated by `autoLogin`)

1. Call `muggle-remote-auth-status`.
2. If **authenticated and not expired** → gate `autoLogin` (per `preference-gates/GATE.md`):
   - Pro-action: proceed with saved session.
   - Skip-action: `muggle-remote-auth-login` with `forceNewSession: true`, then `muggle-remote-auth-poll`.
3. If **not authenticated or expired** → call `muggle-remote-auth-login`, then poll with `muggle-remote-auth-poll`.
4. Do not skip auth and do not assume a stale token still works.

If auth keeps failing, suggest the user run `muggle logout && muggle login` from a terminal.

### Step 2 — Select Project (gated by `autoSelectProject`)

A **project** is the unit on the Muggle AI dashboard that groups test cases, scripts, and runs. The user must pick the one to scan — never auto-select from repo name, branch, or URL heuristics.

The per-repo project cache lives at `<cwd>/.muggle-ai/last-project.json` (via the `muggle-local-last-project-get` / `muggle-local-last-project-set` MCP tools). Look for `Muggle Last Project: id=… url=… name="…"` in session context.

Gate `autoSelectProject` (per `preference-gates/GATE.md`). Cache: `Muggle Last Project` session line.
- `always` + cache → use cached `projectId`, proceed to Step 3. No cache → fall through to `ask`.
- `never` → full project list; skip Picker 2.
- `ask` → project list picker (see gate file for spec + Picker 2 override). Skip Picker 2 if "Create new project".

### Logic

1. Call `muggle-remote-project-list` (only when not satisfied by the `always` cache).
2. Use `AskQuestion` to present projects as clickable options. Include the project URL in each label so the user can disambiguate. Always include "Create new project" as the last option.
3. Wait for explicit selection.
4. If the user picks "Create new project": collect `projectName`, `description`, and `url`, then call `muggle-remote-project-create`.

Store `projectId` and `projectUrl` only after the user confirms — both are needed downstream.

### Step 3 — Scan Test Cases

Pull the full set of test cases for the project. The list endpoint is paginated.

1. Call `muggle-remote-test-case-list` with `projectId`. Start at page 1; continue requesting pages until the response indicates no more items. Use a generous `pageSize` (e.g. 100) to keep the call count low.
2. Accumulate everything into a single in-memory array.
3. Tell the user the totals as you go if the project is large (e.g., "Found 247 test cases across the project").

If the call returns zero test cases, stop and tell the user — there is nothing to regenerate. Suggest they create test cases first (point them at `muggle-test` or `muggle-test-feature-local`).

### Step 4 — Filter to Missing Scripts

Apply the default filter: keep only test cases where `status` ∈ `{DRAFT, GENERATION_PENDING}`.

Then show a one-line summary. Also surface how many cases are currently `GENERATING` so the user knows about in-flight work (but don't include them in the candidate list unless they override the filter):

```
Project: <name> (<projectId>)
Total test cases: 247
With active script (skipped): 198
Currently generating (skipped, in-flight): 32
Needs regeneration: 17
  • DRAFT: 12
  • GENERATION_PENDING: 5
```

If after filtering the list is empty, congratulate the user — every test case already has an active script — and stop. Do not invent work.

### Step 5 — Present and Confirm Selection

Use `AskQuestion` with `allow_multiple: true` to present every candidate test case as a clickable option. The user must explicitly approve which ones to regenerate.

For each option label, show enough context for the user to make a real decision:

```
[<status>] <title> — use case: <use case title>
```

For example:
- `[DRAFT] Sign up with valid email — use case: User Registration`
- `[GENERATION_PENDING] Add item to cart — use case: Checkout Flow`

Default behavior:
- If there are **≤ 25** candidates, present all of them in a single `AskQuestion` with everything pre-checked and let the user deselect anything they want to skip.
- If there are **> 25** candidates, show the first 25 ranked by status priority (`DRAFT` → `GENERATION_PENDING`), plus a tail option **"Include all N — don't make me click each one"**. The user can also pick "Show next batch" to see more.

After selection, call `AskQuestion` once more for a final confirmation:

> "About to start remote test script generation for **N** test cases against `<projectUrl>`. This will consume Muggle workflow budget. Proceed?"
>
> - "Yes, start all N"
> - "No, cancel"

Only proceed after the user picks "Yes".

### Step 6 — Dispatch Remote Generations (Bulk)

Send a single bulk request instead of dispatching one workflow per test case:

1. Call `muggle-remote-workflow-start-test-script-generation-bulk` with:
   - `projectId` — from Step 2
   - `name` — `"muggle-test-regenerate-missing: bulk ({count} test cases)"` where `{count}` is the number of selected test cases
   - `testCaseIds` — array of all selected test case IDs from Step 5
2. The backend handles looking up full test case details (goal, precondition, instructions, expectedResult, url), so there is no need to call `muggle-remote-test-case-get` per test case.
3. Parse the response to get the `items` array with per-test-case status. Each item contains the test case ID, dispatch status, and (when successful) the workflow runtime ID.

**Failure handling:** the bulk API returns per-item status in the response `items` array. Individual test cases may fail (validation error, missing field, etc.) while others succeed. Surface failures in the Step 7 report — partial progress beats no progress.

### Step 7 — Report

After the bulk dispatch returns, build a summary table from the response `items` array. Each item contains a test case ID, dispatch status, and (when successful) a workflow runtime ID. Cross-reference with the test case list from Step 3 to fill in titles and use case names:

```
Test Case                          Use Case             Prev Status       Dispatch       Runtime
───────────────────────────────────────────────────────────────────────────────────────────────────
Sign up with valid email           User Registration    DRAFT             ✅ started      rt-abc123
Sign up with disposable email      User Registration    DRAFT             ✅ started      rt-def456
Add item to cart                   Checkout Flow        GENERATION_PEND.  ✅ started      rt-ghi789
Apply expired coupon               Checkout Flow        GENERATION_PEND.  ❌ failed       —
───────────────────────────────────────────────────────────────────────────────────────────────────
Total: 17 dispatched | 16 started | 1 failed
```

For failures: include a one-line error excerpt from the item's error field and (where possible) a hint at the cause (e.g., "missing instructions field — edit the test case in the dashboard, then re-run this skill").

### Step 8 — Open the Dashboard

Open the Muggle AI dashboard so the user can watch progress visually:

```bash
open "https://www.muggle-ai.com/muggleTestV0/dashboard/projects/{projectId}/runs"
```

Tell them:

> "I've opened the project's runs page. Generation jobs typically take a few minutes each — they'll appear here as they progress. Your test cases will move into `ACTIVE` status as scripts complete."

### Step 9 (optional) — Poll Status

Only if the user explicitly asks for a status check, call `muggle-remote-wf-get-ts-gen-latest-run` for each runtime ID and report progress. **Do not poll on a tight loop by default** — the dispatch step is the actual goal of this skill, and the dashboard already shows live status better than a CLI loop ever can. Polling exists as a courtesy for users who don't want to leave the terminal.

If the user wants a one-shot snapshot, present a small table:

```
Test Case                Runtime     Status      Steps so far
────────────────────────────────────────────────────────────
Sign up with valid email rt-abc123   RUNNING     6
Add item to cart         rt-ghi789   COMPLETED   12
```

## Tool Reference

| Phase | Tool |
|:------|:-----|
| Auth | `muggle-remote-auth-status`, `muggle-remote-auth-login`, `muggle-remote-auth-poll` |
| Project | `muggle-remote-project-list`, `muggle-remote-project-create` |
| Scan | `muggle-remote-test-case-list` (paginated) |
| Dispatch | `muggle-remote-workflow-start-test-script-generation-bulk` |
| Status (optional) | `muggle-remote-wf-get-ts-gen-latest-run`, `muggle-remote-wf-get-latest-ts-gen-by-tc` |
| Browser | `open` (shell command) |

## Non-negotiables

- **The user MUST select the project** — present projects via `AskQuestion`, never infer from cwd, repo name, or URL guesses.
- **The user MUST approve which test cases to regenerate** — show the candidates via `AskQuestion`, let them deselect, then confirm again before any dispatch. Bulk-regenerating without approval can waste meaningful workflow budget.
- **Default filter is `DRAFT` + `GENERATION_PENDING`** — never include `GENERATING`, `ACTIVE`, `DEPRECATED`, `ARCHIVED`, `REPLAYING`, or `REPLAY_PENDING` unless the user explicitly says so. `GENERATING` already has a workflow in flight and dispatching another races against it. `ACTIVE` test cases already have working scripts. The rest reflect deliberate user decisions or in-flight replays the skill should not interfere with.
- **Use the bulk endpoint for dispatch** — call `muggle-remote-workflow-start-test-script-generation-bulk` once with all selected test case IDs rather than dispatching one-by-one. The backend resolves full test case details internally.
- **Failures don't abort the batch** — the bulk API returns per-item status. Surface failures in the report. Partial progress beats no progress.
- **Open the dashboard, don't poll by default** — the runs page is the canonical view of progress. Only poll if the user explicitly asks.
- **Use `AskQuestion` for every selection** — never ask the user to type a number.
- **Can be invoked at any state** — if the user already has a project chosen in conversation context, skip Step 2 and go straight to scanning.
