# Data deliverable check

The flow for a `[data]` criterion. Shared rules — obtaining the artifact, verdicts, the report entry — live in the `deliverable-categories.md` index beside this folder, which opens this file.

**Verified by:** deliverable check.

## Artifact

A dataset or export — CSV, JSON, JSONL, Parquet, seed data: committed at head, or produced by the repo's export command.

## Probes

Run as a script written outside the worktree, so the check leaves the change untouched.

- The file parses in its format.
- Schema fields and types.
- Row count, against the expected count or range.
- Required fields filled.
- Key uniqueness.
- Values inside stated ranges or enumerations.
- References to other files or tables resolve.

A changed dataset is also diffed against its base-branch version: fields added or removed, type changes, row-count delta.

## Review

Read the first rows and a random sample of rows against the criterion.

## Inconclusive when

- The dataset cannot be produced for an environment reason.
