# CI check → local fix command

Map a red CI check to the local command that reproduces and fixes it. Repo-agnostic — read the repo's `package.json` scripts; never hardcode script names.

| Failing check | Local action |
| :------------ | :----------- |
| lint / format | Run the repo's lint `--fix` / formatter; restage. |
| typecheck | Run the typecheck script; read the errors; edit the types. |
| unit / test | Run the suite; read the failures; fix the code or the test. |
| `muggle-walkthrough` — the Muggle E2E walkthrough check | In scope. Its check-run summary names each failed or inconclusive case with the failing step and a link to the run; the walkthrough comment's hidden `muggle-e2e-result` record carries the same cases with their test case ids. Repair each, re-run the **whole** E2E suite, and settle the walkthrough comment with the new result — editing the comment re-runs the check. A summary saying the comment is still empty means no run was ever posted: run the suite and post it, or — when the session holds no E2E plan or a `unit-only`/`skip` one — settle it with the verified skip code that holds. Deterministic: it reads the comment, so re-running it unchanged returns the same verdict. |
| non-deterministic — an LLM-judged eval gate (e.g. `skill-routing-eval`, `skill-gate-eval`, `agent-gate-eval`) or another check whose verdict can flip with nothing changed | Re-run its failed jobs once per head, without a push: `gh run rerun <run-id> --failed` (GitLab: retry the failed job). The re-run counts as a fix attempt. Escalate only if it fails again on the same head. How long the check takes is never a reason to skip the re-run. |
| out of scope — any other E2E-in-CI, build/deploy infra, or unknown | Do **not** attempt; record for escalation. |
