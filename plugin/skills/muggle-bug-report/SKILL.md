---
name: muggle-bug-report
model: haiku
description: "Use when the user wants to report a bug in Muggle AI itself (a muggle command or tool erroring, a run hanging, a dashboard or billing problem), or to list, check (BUG-4821) or reply to their bug reports. Not for bugs in the user's own app, nor a generated test script step that misbehaved (muggle-feedback). Triggers on /muggle-bug-report, report a muggle bug."
---

# Muggle Bug Report

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-bug-report"`.

> Running outside Claude Code (in Codex, for one)? Read [`../_shared/host-tool-equivalents.md`](../_shared/host-tool-equivalents.md) first — it maps the tools and paths this skill names to your host's.

Files a bug about Muggle AI to the Muggle team and follows it: every report gets a short id (`BUG-4821`), a ticket page on the dashboard, and in-app updates as the team works it.

## Routing

| Intent | Op file |
|---|---|
| "report a bug" / "muggle is broken" / "file this" / no arguments | [`ops/file.md`](ops/file.md) |
| "my bug reports" / "list my tickets" | [`ops/list.md`](ops/list.md) |
| "status BUG-4821" / "what happened to my report" | [`ops/status.md`](ops/status.md) |
| "reply to BUG-4821" / "answer their question" | [`ops/reply.md`](ops/reply.md) |

If intent is ambiguous, use `AskUserQuestion` once with **File a bug / List my reports / Check one / Reply** — never ask the user to type a clarification.

## Constraints (all ops)

- **Every tool takes the `bugReportId`, never the short id.** Turn a `BUG-NNNN` the user names into its `bugReportId` with `muggle-remote-bug-report-list`: page with `pageSize: 50`, passing `nextCursor` back as `cursor`, until an item's `shortId` matches. No match on any page → say so and show the list.
- **Screenshots are paths on this machine**: images only (png, jpg, gif, webp), at most 5, 5 MB each. Pass absolute paths in `screenshotPaths`; the tool reads and uploads them.
- **Not signed in** (`UNAUTHORIZED`): hand off to the `muggle-login` skill, then resume the op.
- **`dashboardUrl`** in each response is the ticket's page; print it with the short id.

## Non-negotiables (all ops)

- Never file or reply without showing the user exactly what will be sent and getting a confirm.
- Never add context the context tool did not return, and never put a secret, token or password in a title, description, steps or reply. If the user's text contains one, point it out and ask them to remove it before filing.
- Show only what the response holds; never guess a ticket's status or what the team will do.
