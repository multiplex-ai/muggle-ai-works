# Post Walkthrough (or Create the PR First)

Shared procedure for posting a Muggle Test visual walkthrough to a PR after a test run. Used by `muggle-test` (step 9b/9c) and `muggle-test-feature-local` (step 10b/10c).

## Prerequisite

The caller has already assembled an `E2eReport` from the run (passed + failed + inconclusive). The report shape is documented in [`muggle-pr-visual-walkthrough/e2e-report-assembly.md`](../muggle-pr-visual-walkthrough/e2e-report-assembly.md).

## Procedure

### 1. Detect the PR

```bash
gh pr view --json number,title,url 2>/dev/null
```

Branch on the result into Case A or Case B.

### 2. Apply the `postPRVisualWalkthrough` gate

Follow the standard gate procedure in [`../muggle-preferences/preference-gates/README.md`](../muggle-preferences/preference-gates/README.md) using [`postPRVisualWalkthrough.md`](../muggle-preferences/preference-gates/postPRVisualWalkthrough.md). The gate's Case A / Case B handling already covers both branches:

- **Case A (PR found)** — picker chooses post vs skip.
- **Case B (no PR)** — `always` silently creates the PR (push + `gh pr create`) then proceeds to post; `never` skips; `ask` offers create-and-post or skip via Picker 1.

On the skip path, stop here and let the caller's workflow continue.

### 3. Invoke the shared skill in Mode A

If the gate resolved to post, invoke [`muggle-pr-visual-walkthrough`](../muggle-pr-visual-walkthrough/SKILL.md) via the `Skill` tool with the `E2eReport` in context. **Mode A** (post to an existing PR) — the skill renders the markdown via `muggle build-pr-section`, posts `body` as a PR comment, posts the overflow `comment` only if the CLI emitted one, and confirms the PR URL.

Never hand-write the walkthrough markdown or call `gh pr comment` directly — always delegate to the skill.
