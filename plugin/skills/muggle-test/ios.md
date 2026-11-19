# Mode C: iOS Build

Tests an iOS simulator build on the Muggle iOS pool: Mac hosts that install the build on a simulator and drive it with an agent toward a plain-language goal. Every call goes through the `muggle-remote-ios-*` tools; Steps 2 and 5–10 of [`SKILL.md`](SKILL.md) do not apply.

## Status and verdict

A run carries two separate fields; never merge them.

| Field | Values | Says |
| :---- | :----- | :--- |
| `status` | `queued`, `claimed`, `running`, `completed`, `infra_error`, `timed_out`, `cancelled` | Whether the pool finished running it |
| `verdict` | `passed`, `failed`, `goal_unachievable`, or `null` | Whether the app did what the task asked; set only on a `completed` run |

A run that ends `infra_error`, `timed_out` or `cancelled` is a machinery failure: report it as **inconclusive**, never as a failed test.

## Steps

1. **Authenticate and pick the project** per Steps 3 and 4 of [`SKILL.md`](SKILL.md).
2. **Build.** Reuse a stored build when `muggle-remote-ios-build-list` has one for the current commit. Otherwise build for the simulator and zip the bundle:
   ```bash
   xcodebuild -scheme <Scheme> -sdk iphonesimulator -configuration Debug -derivedDataPath build
   ditto -c -k --keepParent build/Build/Products/Debug-iphonesimulator/<App>.app <App>.app.zip
   ```
   Read the bundle id with `/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' <App>.app/Info.plist`. Building needs macOS with Xcode; on any other machine, ask the user for the zip's path.
3. **Upload.** `muggle-remote-ios-build-upload` with the zip's absolute path, bundle id, target runtime, `git rev-parse --abbrev-ref HEAD` and `git rev-parse HEAD`. Pass the path only; the tool hashes and streams the file itself. Keep the returned `artifact.digest`.
4. **Queue.** One `muggle-remote-ios-run-create` per behavior to verify, each `task` naming one atomic, observable goal ("Add a note titled Groceries and see it in the list"). Map the change summary to those behaviors the way Step 2 of [`SKILL.md`](SKILL.md) maps a diff to flows. Pass login credentials as `secretRefs` naming project secrets (create them with `muggle-remote-secret-create`), never as values in the task. Queue several runs in one message; the pool runs them in parallel.
5. **Wait.** Poll `muggle-remote-ios-run-get` about every 15 seconds until `isFinished`. If a run is still `queued` after 10 minutes, no simulator host is free: stop polling, report it as inconclusive with its `runId`, and tell the user they can check it later with `muggle-remote-ios-run-get`.
6. **Evidence.** For every finished run, read `muggle-remote-ios-run-steps-get` and keep each step's description, outcome and `screenshotUrl`.
7. **Report.** `passed` counts as passed; `failed` and `goal_unachievable` count as failed, each with the step where it went wrong and that step's screenshot; machinery failures count as inconclusive. The PR walkthrough renders web runs only, so report iOS results in the conversation, or in the acceptance-tester's Test Summary when dispatched by it.

## Guardrails

- Never read, base64 or paste the build archive; the upload tool streams it from disk.
- Never put a secret value in a task or a tool argument; reference it by name in `secretRefs`.
- Never report a machinery status as a test failure, or a missing verdict as a pass.
- Never retry a run that ended `failed` as if it were flaky; a failed verdict is the app's result.
