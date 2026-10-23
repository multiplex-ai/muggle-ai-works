# Start services

For each service, launch from its run directory ([resolve-sources](./resolve-sources.md)) in the background through the shipped process cap: wrap the service's start command as `node <plugin-root>/scripts/guard-run.mjs --service -- <command>` (resolve `<plugin-root>` from `CLAUDE_PLUGIN_ROOT`). The wrapper is plain node and picks the cap mechanism per OS itself, so the instruction is the same everywhere; it kernel-bounds the service's process tree (a runaway spawn loop dies at the cap, not the machine) while letting the service outlive this session. From the Bash tool:

```bash
cd "<run-dir>" && nohup node "${CLAUDE_PLUGIN_ROOT}/scripts/guard-run.mjs" --service -- <command> > "<log>" 2>&1 &
echo $!
```

`<log>` is the service's log path under its checkout's log directory ([PID Tracking](../SKILL.md#pid-tracking)); create the directory first. Capture the PID and write the service's entry — with `headSha` from `git -C <run-dir> rev-parse HEAD` and `startedAt` — to the tracking file of the checkout it runs from. Never write an entry into another checkout's file.

**Startup verification** — confirm PID alive (`kill -0 <pid> 2>/dev/null`), then run the two-stage readiness probe per [`../../_shared/dev-server-readiness.md`](../../_shared/dev-server-readiness.md) against the log. Cap log-tail at 60 s. Halt on whatever surfaces.

A boot that takes most of the 60 s cap but keeps making progress is a property of this stack, not a fault — record it per [record-resolution](./record-resolution.md) so the next run expects the wait instead of treating it as a hang.

If a PID dies immediately, consult the recipe's recorded resolutions for this service first; apply a match without asking. Otherwise show the last 20 log lines:

> "**backend-api** exited right after starting. Here's the tail of its log:"

- Option 1: "Skip it and continue with the others"
- Option 2: "Let me fix it — I'll re-invoke later"

**Port discovery** — if the port wasn't known upfront, re-scan listening ports after startup. Record it in the service's tracking entry. If not found within ~10 s, mark port unknown.
