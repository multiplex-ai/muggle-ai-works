---
name: muggle-register
model: haiku
description: "Create a new Muggle AI account: sign up or register."
---

# Muggle Test Register

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-register"`.

> Running outside Claude Code (in Codex, for one)? Read [`../_shared/host-tool-equivalents.md`](../_shared/host-tool-equivalents.md) first — it maps the tools and paths this skill names to your host's.

Create a Muggle AI account and store its API key.

## Password handling

Never repeat the password in a reply, a log, a file, a commit, or a telemetry event. Pass it only as the `password` argument of `muggle-remote-auth-register`, which sends it once and keeps no local copy.

## Steps

1. **Check the current identity** — call `muggle-remote-auth-status`. If an account is already signed in, registering replaces its stored key, so name that account and use `AskUserQuestion` to confirm before continuing. On a no, stop.

2. **Collect the credentials** — take the email from the skill's arguments when given, otherwise ask for it. Ask for a password of at least 8 characters.

3. **Register** — call `muggle-remote-auth-register` with `email` and `password`.

4. **Act on the `outcome`:**

   | Outcome | Action |
   |---------|--------|
   | `created` | Call `muggle-remote-auth-status` to confirm the key works, then report per **Output**. |
   | `already-registered` | Say the address already has an account, then run the `muggle-login` skill. |
   | `throttled` | Report the tool's `message`, including any wait. Do not retry. |

   Any other failure raises an error: show its message and stop. If the service looks unreachable, point the user at `/muggle:muggle-status`.

## Output

```
Muggle AI — Account created

Email       <email>
Plan        <plan>
Tokens      <tokensGranted> available now
API key     stored — remote tools use it automatically

Verify <email> to move to the Starter package and raise the allowance to <tokensOnVerification> tokens.
```

The account works unverified, so verification never blocks the next step.
