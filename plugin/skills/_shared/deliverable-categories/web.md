# Web deliverable check

The flow for a `[web]` criterion. Shared rules — tagging, verdicts, the report entry — live in the `deliverable-categories.md` index beside this folder, which opens this file.

**Verified by:** test cases.

## Artifact

The running app at the cycle's validation target: the dev server the readiness check brings up from the PR's worktree, or the preview URL a staging replay names.

## Test cases

Each criterion maps to the impacted or new Muggle test cases that exercise it, recorded as `coveredBy` in the scope. A new test case names one atomic behavior to verify, with prerequisites resolved from the project's test-plan graph rather than written into the case.

## Review

The run's step screenshots, read against the criterion: the element the criterion names is on screen, in the stated state, at the step that asserts it.

## Inconclusive when

- No replayable script exists and generation fails.
- The test case's prerequisites cannot be satisfied.
- The runner fails before reaching the assertion for a reason outside the product: an infrastructure error, a missing secret, an auth or cookie banner it could not clear.

An app that never answers is not inconclusive: the cycle halts for readiness and owes the run.
