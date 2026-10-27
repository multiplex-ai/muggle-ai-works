# Claim the stack

The machine runs **one** set of local services: one process per port, shared by every session on it. Before anything is checked, started or restarted, claim the ports this run needs, so two sessions never restart each other's services mid-run, or test against code that isn't theirs. Runs on every invocation, learning runs and replays alike, right after [resolve-sources](./resolve-sources.md) — in-session, never in the agent, because a busy stack has to reach the caller.

## Claim

One `--need` per service with an expected port, naming its run directory from [resolve-sources](./resolve-sources.md). The commit defaults to what that directory has checked out, which is the commit it must serve:

```bash
muggle stack claim --cwd "<caller's checkout>" --label "<branch or task>" \
  --need 3000=<run-dir-of-frontend> --need 8080=<run-dir-of-backend> --json
```

A service whose port is not known yet goes unclaimed this run; [start-services](./start-services.md) records the port it finds, and the next invocation claims it.

The claim answers at once. It never waits on a peer unless asked to.

- **`GRANTED`** (exit 0) → the ports are this checkout's to use, alongside any session that needs the same code there (`sharedWith`). Each `plan` entry says what to do with its port, and travels in the resolved plan to the execute phase:
  - `keep` — a tracked service already serves this directory and commit. [check-running](./check-running.md) still proves it.
  - `start` — nothing tracked serves the port.
  - `restart` — a tracked service serves other code that no session's lease needs any more, even when it was started from another checkout. [check-running](./check-running.md) replaces it.
- **`BUSY`** (exit 75) → another session's lease needs different code on a port this run needs, or a session ahead in line is still owed its turn there. Nothing was started or stopped. Don't ask the user to kill anything or pick another port — the line exists so they never have to. Return to the caller with the blockers (port, who holds it, for how long) and this checkout's `position`. The place is kept for as long as the checkout keeps asking. The caller does other work (unit tests, the next PR, cloud-side fetches) and invokes prepare again after `retryAfterMs`. With nothing else left to do, re-claim with `--wait <seconds>` to wait in the call.

`muggle stack status` shows every lease, the line, and the services prepare tracks, without taking a place.

## The lease

A granted claim is a lease, and it is held only while this session is testing. Each local execute run records itself on the lease while it is in flight. Nothing else extends it: not a re-claim, and not `muggle stack check`. So go straight from the grant to starting services and running. Never hold a lease while rebasing, editing code or waiting on CI; a renew loop cannot keep it. The lease ends, and its ports pass to whoever is next in line, when:

- **Two minutes pass with no run in flight** after the last run ended. That covers the turn between consecutive runs of one batch. Debugging a failure, rebasing or fixing code takes longer: the lease ends, and prepare re-claims before the next run.
- **15 minutes pass after the grant with no run started.** That is the time prepare has to start its services.
- **The session died.** Each run records the session's MCP server as a holder. Once every holder has exited and a minute has passed, the lease ends. The minute rides out an MCP server restart.
- **It is released** in [Cleanup](../SKILL.md#cleanup).

**A lease that ends takes its services with it.** Whatever listens on a port whose code no remaining lease needs is stopped. That covers services prepare started and ones started by hand, along with their launchers. The session's own MCP server ends the lease two minutes after its last run. Otherwise the next claim, run or release on the machine does it. A service marked `external: true` is never stopped, and neither is one another lease still needs.

The lease belongs to the checkout, not to one run. Every test case of the same change, including cases run in parallel, runs under it, and none of them waits on the others.

The line is first come, first served per port, and it is pulled, not pushed: nothing calls a waiting session back. A session keeps its place by asking again within the suggested delay, and is served before anyone behind it who wants the same port. A session that stops asking keeps its turn for 30 seconds after the port frees, and its place for 10 minutes.

Holding a lease is optimistic, not exclusive. Nothing stops another process from binding a port. Instead, the local execute tools check the lease before every run and again when it ends:

- A run whose port another session's lease holds, from a checkout that never claimed it, is refused: `Run refused — the target port is leased to another checkout`.
- A run whose claimed port no longer serves the claimed code is refused: `Run refused — the service stack changed since this checkout claimed it`. Re-invoke prepare: it re-claims and restarts what moved.
- A run during which the stack changed returns its result with a warning, and that result is not trusted until it has been re-run.

None of these is a test result. Never route them through failure handling.
