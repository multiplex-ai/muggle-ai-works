---
name: muggle-logout
model: haiku
description: "Sign out of Muggle AI and clear stored credentials. Use on muggle logout or when asked to log out of Muggle."
---

# Muggle Logout

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-logout"`.

> Running outside Claude Code (in Codex, for one)? Read [`../_shared/host-tool-equivalents.md`](../_shared/host-tool-equivalents.md) first — it maps the tools and paths this skill names to your host's.

## Steps

1. Call `muggle-remote-auth-logout`.
2. Call `muggle-remote-auth-status` to confirm the credentials are gone, and report it.
