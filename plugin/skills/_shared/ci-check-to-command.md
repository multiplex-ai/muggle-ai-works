# CI check → local fix command

Map a red CI check to the local command that reproduces and fixes it. Repo-agnostic — read the repo's `package.json` scripts; never hardcode script names.

| Failing check | Local action |
| :------------ | :----------- |
| lint / format | Run the repo's lint `--fix` / formatter; restage. |
| typecheck | Run the typecheck script; read the errors; edit the types. |
| unit / test | Run the suite; read the failures; fix the code or the test. |
| out of scope — E2E-in-CI, build/deploy infra, flaky / non-deterministic, or unknown | Do **not** attempt; record for escalation. |
