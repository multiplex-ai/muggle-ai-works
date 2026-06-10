# MR pipeline rollup

Fetch the CI state for an MR's head — what the watcher polls to detect red CI. GitLab runs **one** pipeline of jobs per commit, not independent check-runs, so the rollup is over that pipeline's jobs.

```bash
glab ci status -R <group>/<project> -b <source_branch>
```

Or straight from the API for the latest pipeline and its jobs:

```bash
glab api projects/:id/merge_requests/:iid/pipelines --jq '.[0].id'
glab api projects/:id/pipelines/<pipeline-id>/jobs --paginate
```

Each job:

- `name` — the job's name (e.g. `lint`, `test`, `build`).
- `status` — one of `success` / `failed` / `running` / `pending` / `created` / `canceled` / `skipped` / `manual`.

Classify for the watcher:

- **red** — any job `failed`. Candidate for fix-ci.
- **pending** — no job `failed`, but any job `running` / `pending` / `created`. Pipeline hasn't settled → idle.
- **green** — every job `success` / `skipped` / `manual` / `canceled`, or no jobs at all.

The fix-ci dispatch carries the `name`s of the `failed` jobs.
