---
name: muggle-run-view
model: haiku
description: "Show a local Muggle test run's steps beside the frames they produced. Use on muggle run-view or when asked to view or replay what a local run did."
---

# Muggle Run View

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-run-view"`.

> Running outside Claude Code (in Codex, for one)? Read [`../_shared/host-tool-equivalents.md`](../_shared/host-tool-equivalents.md) first — it maps the tools and paths this skill names to your host's.

## Steps

1. Take the run id from the arguments. A unique prefix works; with none, the newest run opens.
2. Run `muggle run-view [runId] --open`, which renders an HTML page and opens it in the browser.
3. In a session with no browser, run `muggle run-view [runId]` for the terminal view.
