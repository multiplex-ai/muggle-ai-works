# Audit trail

What a cycle shows the user before it ends: the tests the change involved, their results, and links to the proof. It reports and gates nothing. Anything missing is stated in the block, never a reason to stop, retry, or ask.

## Where it prints

- **Forward cycle** — before the Stage 8 arms ([`open-prs/forward.md`](open-prs/forward.md#stage-8-handoff)), whatever Stage 7.5 cleared.
- **Watcher cycle** — before the watch re-arms ([`respawn-watcher.md`](respawn-watcher.md)). A cycle that changed nothing prints nothing.
- **Terminal turn** — before the ending selector ([`next-step.md`](next-step.md)), from the record [`cleanup.md`](cleanup.md#terminal-record) captured before teardown.

One block per PR, in the terminal only. The PR keeps its own walkthrough.

## Sources

- **Unit tests** — the tests the change added or changed, read from `git diff <base>...HEAD` on test paths, each with its name, file path and result from the latest unit run, then that run's overall result. A bug fix's regression test comes first, with `failed before, passed after` from Stage 3.
- **E2E tests** — every case in the latest E2E report, each with its title, result and `viewUrl`. A skipped run shows its skip code and detail.
- **Evidence** — the PR's walkthrough comment, then the `viewUrl` of each run. Deliverable checks point at the PR's `## Validation` section.
- **Regression** — a bug fix's regression criterion from `requirements.md`, the one line saying what the test proves.

## Shape

```
Audit trail — acme/widget#142

Regression: [web] A duplicate email shows the sign-in prompt instead of a blank page

Unit tests
  PASS  shows the sign-in prompt for a duplicate email — src/signup/signup.test.ts (failed before, passed after)
  PASS  keeps the entered email on error — src/signup/signup.test.ts
  Run: pnpm test — PASS

E2E tests
  PASS  Duplicate sign-up prompts to sign in — https://app.example.com/runs/4f2a
  FAIL  Reset link reaches the inbox — https://app.example.com/runs/91c0

Evidence
  Walkthrough: https://github.com/acme/widget/pull/142#issuecomment-2210
  PR: https://github.com/acme/widget/pull/142

Missing: nothing
```

## Rules

- Links, not ids. An id appears only beside its link.
- Every section prints. An empty one says why: `none — <reason>`. A section with nothing to show still names the gap on the `Missing` line, such as no test changed, no PR opened, or a run with no link.
- `Regression` prints for bug fixes only. A bug fix with no regression test or case says so under `Missing`.
- Results are the recorded ones, never inferred. A run that never happened is `not run`, not a pass.
