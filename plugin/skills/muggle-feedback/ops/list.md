# List feedback

Show feedback the user has filed in the current project. Optionally drill down by test case to keep noisy projects readable.

## 1. Scope to a project

Read `muggle-local-last-project-get`. If set, use it.

If unset: `muggle-remote-project-list` and pick via `AskUserQuestion` (top 5 by recency, plus "Show full list"). Persist with `muggle-local-last-project-set`.

## 2. Fetch

`muggle-remote-user-feedback-list` with `projectId`.

If the response has zero entries, print "No feedback filed yet for `<projectName>`." and offer `AskUserQuestion` with **Submit new feedback / Done**.

## 3. Drill-down (only when noisy)

If the response has more than 10 entries, ask via `AskUserQuestion`:

> "<N> feedback entries in this project. Filter to a specific test case?"
> - **Show all**
> - **Filter by test case**

If filter chosen:

1. `muggle-remote-test-case-list` with `projectId`. Pick one via `AskUserQuestion`.
2. `muggle-remote-test-script-list` with `testCaseId`. Collect the set of `actionScriptId` values across the returned scripts.
3. Client-side filter the feedback list: keep entries where `feedback.target.targetId` either equals one of those `actionScriptId` values (whole-script feedback) or starts with `<actionScriptId>:` (step feedback).

## 4. Render

Markdown table sorted by `createdAt` (newest first):

| # | Target | Test case | Excerpt | Created | Id |
|---|---|---|---|---|---|

- **Target** — "Whole script" or "Step N" (convert wire 0-based index to 1-based for display).
- **Test case** — resolve from the action-script id if not in the filter step. Use a small in-memory cache: for each unique `actionScriptId`, fetch via `muggle-remote-test-script-list` (or the per-script lookup) once.
- **Excerpt** — first 80 chars of `feedbackText`, single line.
- **Created** — human-readable, e.g. `2 days ago`.
- **Id** — the feedback id (truncated to first 8 chars in the table; full id available in detail view).

If the action-script lookup is expensive (many distinct ids), show "Test case: …" and offer "Resolve test case names" as an opt-in via `AskUserQuestion`.

## 5. Offer next action

`AskUserQuestion`:

> "What next?"
> - **View detail** — pick an entry, print full `feedbackText`, full ids, target, dashboard link if remote.
> - **Delete one** — hand off to [`delete.md`](delete.md).
> - **Submit new feedback** — hand off to [`submit.md`](submit.md).
> - **Done**

## Non-negotiables

- Convert wire 0-based step indices to 1-based when rendering to the user.
- Don't fetch test-case names for every row eagerly when the list is huge — make it opt-in past ~20 entries.
