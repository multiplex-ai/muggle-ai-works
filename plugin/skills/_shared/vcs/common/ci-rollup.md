# CI rollup (tool-agnostic)

The single instruction every CI-poll site references — sites link here and never name a provider's rollup recipe inline. Fetch the CI state for a PR/MR head and fold it into one of three buckets: **red**, **pending**, **green**.

Resolve the provider per [`../detect-vcs.md`](../detect-vcs.md), then run its rollup recipe — the recipe owns the fetch command and the raw per-check/per-job states:

- `github` → [`../github/pr-checks.md`](../github/pr-checks.md) — the check-run rollup for the head SHA.
- `gitlab` → [`../gitlab/mr-pipeline.md`](../gitlab/mr-pipeline.md) — the pipeline-job rollup for the head.

Both recipes fold into the same buckets, so a caller branches on the token only to fetch, then reasons on the bucket alone:

- **red** — one or more entries in the `fail` bucket (a failed check-run; a `failed` job). Candidate for fix-ci; the dispatch carries the failing names.
- **pending** — nothing failed but an entry has not settled (`pending` bucket; a `running` / `pending` / `created` job). The result may yet go green.
- **green** — every entry passed, was skipped, or was cancelled, or there are none at all.

The rollup is **non-monotonic** — it flips red↔green and resets on every push. A caller that records a red result keys it on the **head SHA**, not a monotonic id, so the record re-arms on the next push.
