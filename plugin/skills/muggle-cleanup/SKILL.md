---
name: muggle-cleanup
model: haiku
description: "Remove old Muggle browser runner versions and obsolete skills. Use on muggle cleanup. Not for cleaning up after a merged PR."
---

# Muggle Cleanup

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-cleanup"`.

> Running outside Claude Code (in Codex, for one)? Read [`../_shared/host-tool-equivalents.md`](../_shared/host-tool-equivalents.md) first — it maps the tools and paths this skill names to your host's.

## Steps

1. Run `muggle cleanup --dry-run` and show what would be removed. One previous version stays for rollback; add `--all` to remove that too, and `--skills` to include obsolete skills.
2. Nothing to remove → say so and stop.
3. Confirm with `AskUserQuestion`, then run the same command without `--dry-run` and report the space freed.
