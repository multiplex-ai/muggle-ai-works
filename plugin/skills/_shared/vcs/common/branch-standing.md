# Branch standing vs base (tool-agnostic)

The single instruction the rebase trigger references for **conflict** and **out-of-date** detection — sites link here and never name a provider's metadata recipe inline. Both signals read from the metadata snapshot the caller already fetched; this file only says which field each provider reads.

Resolve the provider per [`../detect-vcs.md`](../detect-vcs.md).

## Conflict with the base

- `github` → `mergeable == CONFLICTING`, corroborated by `mergeStateStatus == DIRTY` ([`../github/pr-metadata.md`](../github/pr-metadata.md)).
- `gitlab` → `detailed_merge_status` in `{broken_status, conflict}` ([`../gitlab/mr-metadata.md`](../gitlab/mr-metadata.md)).

A still-computing state — `github`'s `mergeable == UNKNOWN`, `gitlab`'s `checking` / `unchecked` — counts as **not conflicting** this tick.

## Out of date (behind the base)

Read from **commit ancestry**, never from the merge-state field: GitHub masks `BEHIND` behind `DIRTY` / `BLOCKED`, and GitLab reports `need_rebase` only under fast-forward-merge — both hide a stale branch. The compare is exact even while the conflict state is still computing.

- `github` → the compare call in [`../github/pr-metadata.md`](../github/pr-metadata.md#behind-by-out-of-date-detection); `behind_by > 0` ⇒ out of date.
- `gitlab` → the compare call in [`../gitlab/mr-metadata.md`](../gitlab/mr-metadata.md#behind-by-out-of-date-detection); any base commit the head lacks ⇒ out of date.
