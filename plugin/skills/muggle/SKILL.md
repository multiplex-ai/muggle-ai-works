---
name: muggle
model: haiku
description: "Muggle AI command router and menu: the entry point for any question about what Muggle itself offers. Opens an interactive pick-list of Muggle Test commands and launches the one the user chooses, so it is the right first step whenever someone asks what Muggle can do or what commands, options, features or choices it has; asks to list Muggle's commands, all of them or just those for one area (testing, PRs, scripts, config, checking on things); wants a rundown, overview or walkthrough of Muggle; is new to Muggle or unsure where to start; or types \"muggle\" or \"/muggle\" alone. Also use when they name a broad area but are unsure which Muggle command applies and ask to see the options. Invoke it instead of summarizing Muggle's skills yourself - the pick-list turns the answer into the next action. Not for a request that already names one concrete task - that goes straight to the matching muggle skill."
---

# Muggle Test

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle"`.

> Running outside Claude Code (in Codex, for one)? Read [`../_shared/host-tool-equivalents.md`](../_shared/host-tool-equivalents.md) first — it maps the tools and paths this skill names to your host's.

Use this as the top-level Muggle Test command router.

## Preferences

User preferences are injected by the SessionStart hook into a `Muggle Test Preferences` line in session context (key=value pairs). Resolution: shipped defaults → `~/.muggle-ai/preferences.json`. Preferences are user-level and apply to every repo. The line carries every key already resolved, so a key is never absent.

This router skill itself does not gate any decision on a preference — it just routes user intent to a downstream skill. Each downstream skill consults its own preferences. For example, `checkForUpdates` is consulted by `muggle-status` (Check 4), not here.

If the user types "muggle" with no subcommand and you want to surface a contextual hint about the update-check pref, defer to `muggle-status` rather than reimplementing the gate in this router.

## Menu

When user asks for "muggle" with no specific subcommand, use `AskUserQuestion` to present these four options:

- "Test a feature — run E2E acceptance tests locally or remotely" → `muggle-test-feature-local` (local) or `muggle-test` (remote/change-driven)
- "Build something — implement a feature with E2E acceptance tests and a visual PR" → `muggle-do`
- "Health check — verify installation and fix issues" → `muggle-status` (then `muggle-repair` if issues found)
- "Upgrade — update to latest version" → `muggle-upgrade`

## Routing

If the user intent clearly matches one command, route directly — no menu needed:

- status/health/check → `muggle-status`
- repair/fix/install broken → `muggle-repair`
- upgrade/update latest → `muggle-upgrade`
- test my changes/acceptance test my work/test before push/post E2E acceptance results to PR/test on staging/test on preview → `muggle-test`
- test localhost/validate single feature/test a feature → `muggle-test-feature-local`
- build/implement from request/end-to-end → `muggle-do`
- post results to PR/attach walkthrough/visual evidence on PR → `muggle-pr-visual-walkthrough`
- watch my PR for reviews/follow up on PR reviews/babysit PR review thread → `muggle-pr-followup`
- give feedback on a run/the test was wrong/step N didn't work/show my feedback/delete feedback → `muggle-feedback`

If intent is ambiguous, use `AskUserQuestion` with the most likely options rather than asking the user to type a clarification.
