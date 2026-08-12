# Identify required services & startup mode

> Skipped entirely on a replay run — the recipe supplies the service list and startup mode. See [replay-or-learn](./replay-or-learn.md).

**Start from the scan.** [derive-service-graph](./derive-service-graph.md) has already derived services, directories, start commands and ports from the workspace's own manifests. Present that graph for confirmation and ask only about what the scan listed as undetermined — which services this user actually needs, what can't run locally, ordering no manifest declares, and steps that happen by hand. Re-asking something the scan established wastes the scan.

When the scan found nothing (no workspace manifests, an unfamiliar layout), fall back to listing folder names in the **parent directory** of the current working directory:

```bash
ls -d "$(dirname "$PWD")"/*/ | xargs -I{} basename {}
```

Present folder names only (not contents). `AskUserQuestion` with `multiSelect: true`:

> "Which of these need to be running for your tests?"

Pre-check the ones matching the testing scope from [scope](./scope.md). Always include:
- "Just the current project (no other services needed)"
- "None of these — I'll tell you what I need"

Include the current working directory as a candidate. If the user provides manual paths, verify they exist.

**Immediately after selection**, ask startup mode:

> "How do you want to handle these?"

- Option 1: "Check what's running, start what's missing for me"
- Option 2: "I'll start them myself — just verify they're up when I'm done"

**Option 2**: skip [start-commands](./start-commands.md), [fresh-install](./fresh-install.md), [start-services](./start-services.md). Wait for ready signal, then [check-running](./check-running.md), run [smoke-test](./smoke-test.md) against everything (the user-started case is exactly where the smoke test matters most), then [readiness-report](./readiness-report.md).

**Option 1**: proceed through the normal flow.
