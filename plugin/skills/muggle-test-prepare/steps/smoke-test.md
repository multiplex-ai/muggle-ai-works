# Comprehensive smoke test

Runs for **every** service in the tracking file, including `external: true`. Port-listening is not proof a service works — a stale dev server binds and returns 200 with a webpack error overlay.

All three probes must pass:

1. **HTTP** — `GET <serviceUrl>`, 3 s timeout, accept `2xx`/`3xx` (one redirect).
2. **Body sniff** — match response body against broken-build markers in [`../../_shared/dev-server-readiness.md`](../../_shared/dev-server-readiness.md) → "Body sniff patterns".
3. **Log tail** — scan last 200 lines of `/tmp/muggle-prepare-<service-name>.log` for failure patterns after the latest ready signal. Skip for `external: true` (no log).

Use the primitives in `dev-server-readiness.md`. Don't re-implement.

## Diagnose-and-fix loop

On failure, show the concrete signal (HTTP code, sniff hit, or log line) and `AskUserQuestion`:

> "**<service-name>** isn't healthy: `<signal>`. How do you want to proceed?"

- Option 1: **Clean restart** (Recommended) — kill + [fresh-install](./fresh-install.md) + [start-services](./start-services.md) + re-run this step
- Option 2: **Restart only** — kill + start-services + re-run this step
- Option 3: **I'll fix it manually** — pause; re-run on user signal
- Option 4: **Skip** — append to `excluded_services` with reason, continue

Loop per service until pass or skip. Cap at **3 iterations** — then force a manual-intervention pause.

For `external: true`, only Options 3 and 4 apply.
