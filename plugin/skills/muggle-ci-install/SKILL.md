---
name: muggle-ci-install
model: haiku
description: "Add the Muggle walkthrough check to a repository's GitHub Actions. Use on muggle ci-install or when asked to require Muggle E2E in CI."
---

# Muggle CI Install

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-ci-install"`.

> Running outside Claude Code (in Codex, for one)? Read [`../_shared/host-tool-equivalents.md`](../_shared/host-tool-equivalents.md) first — it maps the tools and paths this skill names to your host's.

## Steps

1. Run `muggle ci-install` from the repository root, and report its message.
2. When it kept a workflow the user edited, ask with `AskUserQuestion` before replacing it: `muggle ci-install --force` discards those edits. Never pass `--force` unasked.
3. When it wrote `.github/workflows/muggle-walkthrough.yml`, tell the user to commit it. The check starts with that commit. Do not commit it for them.
