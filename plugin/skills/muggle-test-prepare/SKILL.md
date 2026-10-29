---
name: muggle-test-prepare
model: opus
description: "Get a user's local environment ready before running E2E acceptance tests — verify the dev servers, APIs, and sibling services they need are up and responding, and offer to start whatever is missing (with approval per step). Trigger when the user wants to confirm specific ports or localhost URLs are listening before testing (check if localhost:3000 and the api on 8080 are up, are my services running), spin up their local dev stack, or verify their setup — and whenever another muggle skill (muggle-test, muggle-do, muggle-test-feature-local) needs services running but they're not. This is environment readiness and service startup, not running the tests."
---

# Muggle Test Prepare

> Telemetry first step: see [`_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Use `skillName: "muggle-test-prepare"`.

> Running outside Claude Code (in Codex, for one)? Read [`../_shared/host-tool-equivalents.md`](../_shared/host-tool-equivalents.md) first — it maps the tools and paths this skill names to your host's.

Make sure the local services a user needs for E2E acceptance testing are up and ready. Check what's already running, discover sibling service directories by folder name, and offer to start anything that's missing — always with the user in control.

Some users start their own services (tmux scripts, docker-compose, a terminal per service). Others want help launching them. This skill handles both: it verifies readiness first, and only offers to start things when something is missing.

The skill runs in two phases because a dispatched agent has no channel back to the user. **Decide (in-session):** resolve every choice that needs a human — plan reuse, scope, exclusions, service selection, start approvals. **Execute (agent):** hand the fully-resolved plan to the `test-prepare-runner` agent (`plugin/agents/test-prepare-runner.md`); it runs the mechanical stages headless and returns the readiness verdict, or a `needs-input:` line for any decision the plan left open.

## Privacy Boundary

This skill touches the user's local machine — processes, ports, directories outside the current repo. Every action is explicit and confirmed.

- **Reading is granted, never assumed.** [derive-service-graph](./steps/derive-service-graph.md) asks first: scan a folder the user names, to a depth they set, or skip the scan and take their list of paths and services instead. The granted scope is recorded with the recipe so later runs reuse the permission rather than re-asking; widening it needs a fresh ask.
- **Outside the granted scope, names only.** You may list directory names to offer them as candidates, but never read inside one the user hasn't named. Once they name it, its top-level indicator files (`package.json`, `Makefile`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `docker-compose.yml`) are readable to determine the start command.
- **Never traverse upward more than one level** from the current working directory to list folders.

## PID Tracking

Every launched process is tracked by the **checkout it runs from**, one file per checkout, so parallel sessions never share — or tear down — each other's state:

```
~/.muggle-ai/prepare/running/<source-key>.json     services started from that checkout
~/.muggle-ai/prepare/logs/<source-key>/<name>.log  their logs
```

`<source-key>` is the checkout root's absolute path, made filename-safe exactly as the E2E instructions key is ([e2e-instructions](./steps/e2e-instructions.md#resolve-the-saved-file)).

```json
{
  "source": "/Users/user/Github/app/.claude/worktrees/feat-x",
  "services": [
    {
      "name": "frontend",
      "dir": "/Users/user/Github/app/.claude/worktrees/feat-x/web",
      "command": "npm run dev",
      "pid": 12345,
      "port": 3999,
      "headSha": "9f8e7d6c5b4a39281706f5e4d3c2b1a098f7e6d5",
      "startedAt": "2026-10-22T10:30:00Z",
      "log": "/Users/user/.muggle-ai/prepare/logs/-Users-user-Github-app-.claude-worktrees-feat-x/frontend.log"
    }
  ]
}
```

`headSha` is the commit the checkout had out when the service started — what [check-running](./steps/check-running.md) compares against before trusting a listener. These files are machine-wide and readable by every session: they are how one session learns that a port belongs to another.

This is **ephemeral runtime state**, not the saved recipe. The durable plan lives in `~/.muggle-ai/prepare-plans.json`, under the entry keyed on this stack, and is consulted in [reuse-plan](./steps/reuse-plan.md) before any other stage. The two never merge. The `test-prepare-runner` agent writes the tracking files during execution; Cleanup reads them.

The prose companion to the plan is `~/.muggle-ai/e2e-instructions/<key>.md`, written by [e2e-instructions](./steps/e2e-instructions.md), holding startup order, manual steps, and local gotchas. The plan remains the single source of truth for each service's start command; the markdown never restates one.

**Everything this skill saves is machine-local, user-level data and lives under the Muggle home directory — never inside the user's project.** A project directory is shared, versioned, and cloned onto machines set up differently; a local run recipe is none of those things. Both files are keyed on the same stack identity, so they stay in lockstep.

**On every invocation**, prune dead PIDs from the tracking files silently (verify with `kill -0`). Whether a live service is kept is never asked: [check-running](./steps/check-running.md) keeps one still serving its checkout's current HEAD and restarts one serving older code.

## Code freshness

Every service runs code built on the latest base: the caller's own checkout, synced onto `origin/<base>`, for the repo under test; a base checkout pinned to the latest `origin/<default>` for every other repo. [rebase-check](./steps/rebase-check.md) and [resolve-sources](./steps/resolve-sources.md) run on **every** invocation, replays included — a saved recipe makes the start commands reusable, never the code they start.

## Preferences

Gates run per [`preference-gates/README.md`](../muggle-preferences/preference-gates/README.md). All three resolve in the Decide phase; the agent receives outcomes, never gates.

| Preference | Gates |
|------------|-------|
| `autoRebase` | [rebase-check](./steps/rebase-check.md) — rebase onto `origin/<base>` without asking before starting dev servers; not rebasing stops the run |
| `reusePreparePlan` | [reuse-plan](./steps/reuse-plan.md) — reuse the saved prepare plan for this stack, or rediscover; also [e2e-instructions](./steps/e2e-instructions.md), which goes stale for the same reason |
| `autoSelectLocalHost` | [check-running](./steps/check-running.md) — reuse the recorded dev-server URL silently, or confirm it each run |

## Workflow

**The skill learns once, then replays.** [replay-or-learn](./steps/replay-or-learn.md) decides which, and owns what each mode may do.

A **replay** executes the saved recipe and asks nothing. A **learning run** works through the Decide stages below, then the execute phase, then a single gate — [confirm-recipe](./steps/confirm-recipe.md) — which is the only thing that persists anything.

Decide stages, in order; read each detail file when you reach it:

| Stage | Summary |
|:------|:--------|
| [replay-or-learn](./steps/replay-or-learn.md) | Replay the saved recipe, or learn a new one |
| [derive-service-graph](./steps/derive-service-graph.md) | Derive services from workspace manifests |
| [rebase-check](./steps/rebase-check.md) | Sync every checkout under test onto the latest base — replays too |
| [resolve-sources](./steps/resolve-sources.md) | Pick the checkout each service runs from — replays too |
| [scope](./steps/scope.md) | Frontend / backend / full stack |
| [viability-check](./steps/viability-check.md) | Exclude services that can't run locally |
| [identify-services](./steps/identify-services.md) | Confirm the derived graph; fill the gaps |
| [e2e-instructions](./steps/e2e-instructions.md) | Startup order, manual steps, local gotchas |
| [claim-stack](./steps/claim-stack.md) | Claim the shared ports this run needs, after the last question — replays too; busy returns to the caller |

The Decide phase's output is the **resolved prepare plan**: `services[]` (name, run directory from [resolve-sources](./steps/resolve-sources.md), start command, expected port, `external` flag, approval granted, and the port's `keep` / `start` / `restart` from [claim-stack](./steps/claim-stack.md)), `testingScope`, `excludedServices[]`, the recorded dev-server URL, the E2E run instructions, and resolved gate outcomes.

A replay runs [rebase-check](./steps/rebase-check.md), [resolve-sources](./steps/resolve-sources.md) and [claim-stack](./steps/claim-stack.md) before dispatching. They ask nothing unless a checkout cannot be brought up to date. A busy stack is not a question either: it returns to the caller.

**Execute (agent).** Dispatch the `test-prepare-runner` agent (subagent type `muggle:test-prepare-runner`; bare `test-prepare-runner` where the plugin namespace is absent), synchronously, passing the resolved plan; it returns `READY` / `DEGRADED` plus the readiness table. The agent's own definition lists its stage files; in a harness with no agent/subagent facility, run the execute-phase stages ([check-running](./steps/check-running.md) through [readiness-report](./steps/readiness-report.md)) inline instead.

Relay the readiness table to the user or calling skill verbatim. A `needs-input:` line from the agent names an unresolved decision — resolve it here (asking the user if needed) and re-dispatch; the agent never asks. That path is also how a problem hit mid-preparation reaches the user when it can't be resolved autonomously, per [record-resolution](./steps/record-resolution.md).

The agent also returns the problems it hit and what cleared them. On a learning run those feed [confirm-recipe](./steps/confirm-recipe.md); on a replay they are already in the recipe and are applied without asking.

## Cleanup

Triggered when the user says "stop services", "tear down", "clean up", "I'm done testing", another skill signals run complete, or this skill is re-invoked with "tear down and start fresh". Runs in-session, not in the agent.

Cleanup stops only what runs from the caller's own checkout. Another checkout's services may be mid-run in a peer session, and base-checkout services are shared — they stay up unless the user explicitly asks to stop everything.

1. Read the caller's checkout's tracking file (see [PID Tracking](#pid-tracking))
2. Skip services marked `external: true`
3. For each managed service: `kill <pid>` (SIGTERM)
4. Wait ~2 s, verify with `kill -0`
5. If still alive: `kill -9 <pid>`
6. Delete that checkout's log directory and tracking file
7. `muggle stack release --cwd "<caller's checkout>"` — gives up the lease, so the next session in line can have the ports, and stops every service on its ports that no remaining lease needs, tracked or not. A service another session's lease still needs (a shared base checkout) stays up. Run it as soon as testing ends; a lease no run uses ends on its own two minutes after the last run

Report:

```
Stopped 3 services:
  backend-api    (PID 12345)
  auth-service   (PID 12346)
  frontend       (PID 12347)
```

## Integration Contract (for other skills)

`muggle-test-feature-local`, `muggle-do`, and local-mode `muggle-test` MUST invoke this skill before their first run. Idempotent — fast exit when healthy. Never bypass on "the user knows their stack is up" — that assumption is why this skill exists.

**Ask first, then prepare.** Every question a caller asks before its first run — target, local URL, which script, browser visibility — is answered before it invokes this skill. From the grant to the first run nothing waits on the user or on any other work: a lease whose services are up ends four minutes later with no run, and its services stop ([claim-stack](./steps/claim-stack.md#the-lease)).

After a test run, the caller re-invokes for cleanup once the batch is done. Services stay up only while runs keep coming: two minutes after the last run, the lease ends and its services stop.

**The caller's checkout.** Invoke from the checkout under test — the worktree the change lives in. Its repo is the repo under test, and its services start from that checkout; every other repo's services start from that repo's base checkout ([resolve-sources](./steps/resolve-sources.md)). Pass `base` when the change targets a branch other than the remote default.

**Directory overrides.** A caller testing changes that span several repos at once may pass `directoryOverrides`: a map from a service's repo (its usual directory, or `owner/repo`) to the checkout that service must start from this run — typically a worktree on a feature branch. Each override makes its repo a repo under test, exactly like the caller's own checkout:

- An overridden service starts from the override directory, with its recorded start command. Its install and env-file steps run there too, and [rebase-check](./steps/rebase-check.md) syncs the override first.
- An overridden service already listening counts as running only when [check-running](./steps/check-running.md) proves it serves the override's current HEAD. Otherwise it is the wrong checkout: it is never tested against, and is restarted from the override under the same approval rules as any restart.
- Overrides are per-run. They never enter the saved recipe — a worktree path is not this stack's durable layout.

The readiness table names the directory and commit each service runs from, so the caller can confirm its own code is the code being served.

## Guardrails

- **Never invent or default a host/port** — the dev-server URL is a recorded value, not a guess. Read it from the last-host cache via `muggle-local-last-host-get` (the [`autoSelectLocalHost`](../muggle-preferences/preference-gates/autoSelectLocalHost.md) cache) before probing ports; a framework default like `:3000` is never a fallback. The cache's own storage location belongs to that tool — don't restate it here. See [check-running](./steps/check-running.md).
- **No silent auto-selection without a gate** — when no preference authorizes a silent choice (host, restart, kill), confirm with the user. A gate set to `always` is the only license to skip the question; absent that, ask.
- **Verify first, offer to start second** — check what's already running before proposing to start anything.
- **The user may prefer to start services themselves** — always offer that option.
- **Never start a process the user didn't approve** — approvals are granted in Decide and travel in the plan; the agent starts nothing outside it.
- **Never read file contents outside confirmed directories** — folder names are discoverable; file contents require explicit user selection.
- **Never write a credential into the E2E run instructions** — plaintext notes are not a secret store, and this is the file a user pastes when asking why their stack won't start. Record the env-var or secret name, never its value.
- **Never leave orphan processes untracked** — every background PID goes into its checkout's tracking file.
- **Never kill a process the user started independently** — `external: true` survives cleanup.
- **Never kill or test against another checkout's service** — a listener tracked under a different checkout belongs to a peer session; see [check-running](./steps/check-running.md). The one exception is a port the stack claim planned as `restart`: no session's lease needs that service any more.
- **Never start, restart or kill a service on a port this run has not claimed** — [claim-stack](./steps/claim-stack.md) runs before anything is started, and a busy stack goes back to the caller instead of being worked around.
- **Never hold a lease while waiting** — every question goes before [claim-stack](./steps/claim-stack.md); a `needs-input:` from the runner is a question too, so release before asking it and claim again after.
- **Never start code that is not on the latest base** — no replay, preference, or approval skips [rebase-check](./steps/rebase-check.md) or [resolve-sources](./steps/resolve-sources.md).
- **Never assume start commands** — verify via indicator file; confirm with user.
- **Bail early on non-viable services** — don't start what can't run locally.
- **Idempotent** — a tracked, alive service still serving its checkout's current HEAD is kept; [smoke-test](./steps/smoke-test.md) still runs against it.
- **Port-listening is never enough** — smoke-test (HTTP + body sniff + log tail) is mandatory before the final report.
- **Clean Restart is the recommended fix** — first option in the smoke-test diagnose-and-fix loop; lint/build/missing-deps issues need nuke-and-reinstall.
- **Fresh install is automatic** — [fresh-install](./steps/fresh-install.md) notifies, doesn't ask.
