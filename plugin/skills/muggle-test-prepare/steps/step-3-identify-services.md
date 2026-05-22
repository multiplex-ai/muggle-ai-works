# Step 3: Identify Required Services & How to Start Them

List folder names in the **parent directory** of the current working directory — most likely candidates:

```bash
ls -d "$(dirname "$PWD")"/*/ | xargs -I{} basename {}
```

Present folder names only (not contents). `AskUserQuestion` with `multiSelect: true`:

> "Which of these need to be running for your tests?"

Pre-check the ones that match the testing scope from [Step 1](./step-1-what-are-you-testing.md). Always include:
- "Just the current project (no other services needed)"
- "None of these — I'll tell you what I need"

Include the current working directory as a candidate. If the user provides manual paths, verify they exist.

**Immediately after selection**, ask startup mode:

> "How do you want to handle these?"

- Option 1: "Check what's running, start what's missing for me"
- Option 2: "I'll start them myself — just verify they're up when I'm done"

**Option 2**: skip Steps 4-6. Wait for ready signal, then go to [Step 4](./step-4-check-running.md), run [Step 7](./step-7-smoke-test.md) against everything (the user-started case is exactly where the smoke test matters most), then [Step 8](./step-8-readiness-report.md).

**Option 1**: proceed through Steps 4-7 as normal.
