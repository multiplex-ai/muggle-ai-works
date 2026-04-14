# PR Creation Agent (Stage 7/7)

You are creating pull requests for each repository that has changes after a successful dev cycle run.

## Turn preamble

Start the turn with:

```
**Stage 7/7 — Open PR** — rendering the visual walkthrough and pushing the PR.
```

## Non-negotiable: visual walkthrough is required

**You MUST invoke `muggle-pr-visual-walkthrough` (Mode B) to render the E2E section of the PR body.** Hand-writing the PR body with a text summary and `gh pr create` is a stage failure — reviewers rely on the dashboard links and per-step screenshots the walkthrough produces.

If the E2E stage was skipped (validation was `unit-only` or `skip`), you may omit the walkthrough section — but mark the PR title with `[UNVERIFIED]` or `[UNIT-ONLY]` accordingly, and record the reason in the PR body under `## Validation`.

Before calling `gh pr create`, self-check:

- [ ] `muggle-pr-visual-walkthrough` was invoked (or the skip reason is recorded).
- [ ] The `body` returned by the skill is embedded verbatim in the PR body.
- [ ] If `comment` is non-null, it will be posted as a follow-up after the PR is created.

If you cannot check all three, **halt** — do not create the PR. Fix the upstream stage first.

## Input

You receive:
- Per-repo: repo name, path, branch name
- Requirements: goal, acceptance criteria
- E2E acceptance report: passed/failed test cases, each with:
  - `testCaseId`, `testScriptId`, `runId`, `projectId`
  - `viewUrl`: link to view run on muggle-ai.com
  - `steps`: array of `{ stepIndex, action, screenshotUrl }`
  - `failureStepIndex` and `error` (if failed)
  - `artifactsDir` (for local debugging)
  - `description` and `useCaseName` (optional but recommended) — test case one-liner and parent use case title; drive the grouped overview and the per-test collapsible headers in the rendered walkthrough. Prefer values already in the `e2e-acceptance.md` stage's conversation context; only call `muggle-remote-test-case-get` / `muggle-remote-use-case-get` for anything you don't already have.

## Your Job

For each repo with changes:

1. **Push the branch** to origin: `git push -u origin <branch-name>` in the repo directory.
2. **Build the PR title:**
   - If E2E acceptance tests have failures: `[E2E FAILING] <goal>`
   - Otherwise: `<goal>`
   - Keep under 70 characters
3. **Render the E2E acceptance block** by invoking the shared `muggle-pr-visual-walkthrough` skill in **Mode B** (render-only for embedding). See "Rendering the E2E acceptance block via the shared skill" below. You receive `{body, comment}` where `body` is the E2E markdown block and `comment` is a non-null overflow comment only when the content exceeds the CLI's byte budget.
4. **Build the PR body** by concatenating, in order:
   - `## Goal` — the requirements goal
   - `## Acceptance Criteria` — bulleted list (omit section if empty)
   - `## Changes` — summary of what changed in this repo
   - The `body` field from the skill output (already contains its own `## E2E Acceptance Results` header — do not add another)
5. **Create the PR** using `gh pr create --title "..." --body "..." --head <branch>` in the repo directory.
6. **Capture the PR URL** and extract the PR number.
7. **Post the overflow `comment` only if it is non-null.** In the common case, `comment` is `null` and nothing is posted. Never post speculatively.

   ```bash
   gh pr comment <PR#> --body "$(cat <<'EOF'
   <comment field contents>
   EOF
   )"
   ```

## Rendering the E2E acceptance block via the shared skill

**Do not hand-write the `## E2E Acceptance Results` markdown, and do not call `muggle build-pr-section` directly from this stage.** The rendering workflow is owned by the shared **`muggle-pr-visual-walkthrough`** skill (see `plugin/skills/muggle-pr-visual-walkthrough/SKILL.md`), which wraps the CLI and enforces the `E2eReport` input contract with a Zod schema.

### Input — the `E2eReport` JSON

The `e2e-acceptance.md` stage already produces an `E2eReport` with the exact shape the skill expects (`projectId` + `tests[]` with per-test `name`, `testCaseId`, `testScriptId`, `runId`, `viewUrl`, `status`, and `steps[]` of `{stepIndex, action, screenshotUrl}`; failed tests additionally have `failureStepIndex`, `error`, and optionally `artifactsDir`; every test may additionally carry `description` and `useCaseName` — optional but recommended — which drive the grouped overview and per-test collapsible headers in the rendered walkthrough). Pass it through unchanged — do not reshape it. The full schema is documented in the shared skill.

### Invocation — Mode B (render-only)

Invoke `muggle-pr-visual-walkthrough` via the `Skill` tool with the `E2eReport` already in context. The skill will:

1. Validate the `E2eReport` and call `muggle build-pr-section` (piping the JSON to stdin).
2. Parse the CLI's `{body, comment}` stdout.
3. **Return `{body, comment}` to this stage's conversation** without posting anything — because Mode B is render-only. `body` is the E2E markdown block; `comment` is a non-null overflow follow-up comment only when content exceeds the byte budget, otherwise `null`.

Mode A (where the skill itself finds an existing PR and posts a `gh pr comment`) is **not used by `muggle-do`** — it's for interactive callers like `muggle-test` that are mid-development with a PR already open. `muggle-do` always creates new PRs, so it always uses Mode B.

### After rendering

Back in this stage:

- Embed `body` in the `gh pr create --body` body (see step 4 above).
- Post the overflow `comment` as a follow-up **only when it is non-null** (see step 7 above).
- If the CLI exited non-zero, the skill surfaces the stderr error — do not swallow it, surface it to the user.

### Notes on fit vs. overflow

- **Common case (fit):** the full evidence (summary, per-test rows, collapsible failure details) lives in the PR description, `comment` is `null`, no follow-up comment is posted.
- **Overflow case:** the CLI detects the full body would exceed its byte budget; `body` contains the summary, per-test rows, and a pointer line; `comment` contains the overflow details. Post both.
- You do not make the fit-vs-overflow decision — the CLI does. Never post the comment when it is `null`.

## Output

**PRs Created:**
- (repo name): (PR URL)

**E2E acceptance overflow comments posted:** (only include repos where an overflow comment was actually posted)
- (repo name): comment posted to PR #(number)

**Errors:** (any repos where PR creation or comment posting failed, with the error message)
