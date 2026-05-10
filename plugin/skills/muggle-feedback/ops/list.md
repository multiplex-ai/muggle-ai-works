# List feedback

Show feedback the user has filed. The user usually wants feedback on a specific test case (or test script, or use case) — not the whole project — so the skill picks a scope first.

## 1. Scope to a project

Read `muggle-local-last-project-get`. If set, use it.

If unset: `muggle-remote-project-list` and pick via `AskUserQuestion` (top 5 by recency, plus "Show full list"). Persist with `muggle-local-last-project-set`.

## 2. Pick a narrowing scope

Ask once via `AskUserQuestion` — the list tool accepts at most one narrowing filter:

> "What feedback do you want to see?"
> - **A specific test case** (most common)
> - **A specific test script**
> - **A specific use case**
> - **All in this project**

If the user came from a chained skill or from a recent run, default to the matching narrowing scope and skip this question.

## 3. Resolve the filter id

- **Test case** → `muggle-remote-test-case-list` with `projectId`, `AskUserQuestion`. Pass picked id as `testCaseId`.
- **Test script** → first pick a test case (as above), then `muggle-remote-test-script-list` with `testCaseId`, `AskUserQuestion`. Pass as `testScriptId`.
- **Use case** → `muggle-remote-use-case-list` with `projectId`, `AskUserQuestion`. Pass as `useCaseId`.
- **All in project** → no narrowing param.

Use relevance-first filtering on each picker: top 3-5 most relevant to the user's stated goal, plus "Show full list".

## 4. Fetch

`muggle-remote-user-feedback-list` with `projectId` and at most one of `actionScriptId` / `testScriptId` / `testCaseId` / `useCaseId`.

If the response has zero entries, print "No feedback yet for `<scope description>`." and offer `AskUserQuestion` with **Submit new feedback / Done**.

## 5. Render

Markdown table sorted by `createdAt` (newest first):

| # | Target | Test case | Excerpt | Created | Id |
|---|---|---|---|---|---|

- **Target** — "Whole script" or "Step N" (convert wire 0-based index to 1-based for display).
- **Test case** — when the scope is `testCaseId` or `testScriptId`, all rows share the same test case (use the title from the picker). When the scope is `useCaseId` or project-wide, resolve per row by fetching `muggle-remote-test-script-list` once for each unique `actionScriptId` (cache in-memory) — or skip and show "Test case: …" if there are >20 unique scripts.
- **Excerpt** — first 80 chars of `feedbackText`, single line.
- **Created** — human-readable, e.g. `2 days ago`.
- **Id** — feedback id, truncated to first 8 chars in the table; full id shown in the detail view.

## 6. Offer next action

`AskUserQuestion`:

> "What next?"
> - **View detail** — pick an entry, print full `feedbackText`, full ids, target, dashboard link if available.
> - **Delete one** — hand off to [`delete.md`](delete.md).
> - **Submit new feedback** — hand off to [`submit.md`](submit.md).
> - **Done**

## Non-negotiables

- One narrowing filter only — never set more than one of `actionScriptId` / `testScriptId` / `testCaseId` / `useCaseId` in the same call.
- Convert wire 0-based step indices to 1-based when rendering to the user.
- Don't fetch test-case names per row eagerly past ~20 unique action scripts — make it opt-in.
