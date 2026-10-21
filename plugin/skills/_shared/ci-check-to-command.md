# CI check → local fix command

Map a red CI check to the local command that reproduces and fixes it. Repo-agnostic — read the repo's `package.json` scripts; never hardcode script names.

| Failing check | Local action |
| :------------ | :----------- |
| lint / format | Run the repo's lint `--fix` / formatter; restage. |
| typecheck | Run the typecheck script; read the errors; edit the types. |
| unit / test | Run the suite; read the failures; fix the code or the test. |
| `muggle-walkthrough` — the Muggle E2E walkthrough check | In scope. Its check-run summary names each failed or inconclusive case with the failing step and a link to the run; the walkthrough comment's hidden `muggle-e2e-result` record carries the same cases with their test case ids. Repair each, re-run the **whole** E2E suite, and settle the walkthrough comment with the new result — editing the comment re-runs the check. A summary saying the comment is still empty means no run was ever posted: run the suite and post it. |
| out of scope — any other E2E-in-CI, build/deploy infra, flaky / non-deterministic, or unknown | Do **not** attempt; record for escalation. |
