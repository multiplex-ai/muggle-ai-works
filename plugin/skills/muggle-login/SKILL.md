---
name: muggle-login
model: haiku
description: "Sign in to Muggle AI from the agent, or switch accounts. Use on muggle login or when asked to log in or re-authenticate to Muggle."
---

# Muggle Login

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-login"`.

> Running outside Claude Code (in Codex, for one)? Read [`../_shared/host-tool-equivalents.md`](../_shared/host-tool-equivalents.md) first — it maps the tools and paths this skill names to your host's.

`muggle login` waits on a browser and blocks the agent, so this skill uses the auth tools.

## Steps

1. Call `muggle-remote-auth-status`. Already signed in and no switch requested → report the account and stop.
2. Call `muggle-remote-auth-login`, with `forceNewSession: true` when the user wants another account. Show the verification link and code it returns.
3. Call `muggle-remote-auth-poll` until sign-in completes, then report the account.
