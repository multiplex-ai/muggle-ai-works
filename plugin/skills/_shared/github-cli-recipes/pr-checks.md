# PR check-run rollup

Fetch the CI check state for a PR's head — what the watcher polls to detect red CI.

```bash
gh pr checks <pr-number> --repo <owner>/<repo> --json name,state,bucket,link
```

Each row:

- `name` — the check's name (e.g. `lint`, `typecheck`, `unit`, `build`).
- `state` — `SUCCESS` / `FAILURE` / `PENDING` / `SKIPPED` / `CANCELLED` / `NEUTRAL` (gh folds status + conclusion into one field).
- `bucket` — `pass` / `fail` / `pending` / `skipping` / `cancel`; the coarse rollup — filter on this.
- `link` — the check's details URL, for pulling logs in the fix-ci stage.

Classify for the watcher:

- **pending** — any row with `bucket == "pending"`. Checks haven't settled → idle.
- **red** — any row with `bucket == "fail"` (`state` FAILURE / CANCELLED / TIMED_OUT). Candidate for fix-ci.
- **green** — every row `pass` / `skipping`, or no rows at all.

The fix-ci dispatch carries the `name`s of the red rows. `gh pr checks` exits non-zero when any check fails — capture output regardless of exit code.
