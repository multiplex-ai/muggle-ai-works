# Start services

For each service, launch in the background:

```bash
cd "<service-dir>" && nohup <command> > /tmp/muggle-prepare-<service-name>.log 2>&1 &
echo $!
```

Capture the PID. Write all service entries to `/tmp/muggle-test-prepare.json`.

**Startup verification** — confirm PID alive (`kill -0 <pid> 2>/dev/null`), then run the two-stage readiness probe per [`../../_shared/dev-server-readiness.md`](../../_shared/dev-server-readiness.md) against the log. Cap log-tail at 60 s. Halt on whatever surfaces.

If a PID dies immediately, show the last 20 log lines:

> "**backend-api** exited right after starting. Here's the tail of its log:"

- Option 1: "Skip it and continue with the others"
- Option 2: "Let me fix it — I'll re-invoke later"

**Port discovery** — if the port wasn't known upfront, re-scan listening ports after startup. Record in tracking file. If not found within ~10 s, mark port unknown.
