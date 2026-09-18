# Test Case Chain Readiness

A test case may depend on prerequisite ("parent") test cases in the project's **test-plan graph** — e.g. "edit item" depends on "create item". Before generating or replaying the chosen test case, every ancestor in that chain must already have a ready script, or the run starts from missing state and fails for the wrong reason.

This is the **graph the backend owns** — do not infer the chain from titles or `precondition` text. Read it from `muggle-remote-test-case-ancestors-get`.

**Ready** = `muggle-remote-test-script-list` (with the ancestor's `testCaseId`) returns at least one replayable/succeeded script — the same bar Step 5 uses to offer replay.

## Procedure

Run once the target `testCaseId` is chosen and the local URL + services are confirmed (the generation calls below need `localUrl` and `cwd`).

1. **Resolve the chain.** `muggle-remote-test-case-ancestors-get` with the target `testCaseId`. Response: `{ testCaseId, ancestors, orphan }`.
   - `orphan: false` with empty `ancestors` → the graph places this case as a root: it has no prerequisites. Skip the rest; continue to Step 5.
   - `orphan: true` → the graph holds no node for this case, so its prerequisites are **unknown, not absent**, and running it is a guess about what state already exists. Queue `muggle-remote-test-plan-graph-rebuild` for the project and re-read the chain once it has settled — the call only queues the work, so the graph is not ready the moment it returns.
     One orphan is ordinary. **Every** case in a project reading `orphan: true` means the graph was never built, so nothing orders prerequisites and a bulk replay runs cases that destroy each other's fixtures (one empties a household another needs).
   - Otherwise `ancestors` is ordered **immediate-parent → root**. Reverse it to **root-first** so prerequisites are satisfied bottom-up.

2. **For each ancestor, root-first:**
   - Check readiness via `muggle-remote-test-script-list` (`projectId`, `testCaseId` = ancestor). Ready → skip to the next ancestor.
   - Not ready → **generate its script only (never replay):**
     1. `muggle-remote-test-case-get` for the ancestor.
     2. Determine `freshSession` for that ancestor from its own content — same rules as Step 6.
     3. `muggle-local-execute-test-generation` with the ancestor test case, `localUrl`, `cwd`, and a long `timeoutMs` (see Step 6's timeout guidance). Do **not** call `muggle-local-execute-replay`. The studio publishes the generated run during execution, promoting its script as that ancestor's canonical replay script — it now reads as ready for any case downstream (confirm via `muggle-local-run-result-get` carrying a `cloudActionScriptId`).

3. **All ancestors ready** → continue to Step 5 for the target test case.

## When an ancestor's generation fails

If an ancestor's generation does not reach `passed` (read it via `muggle-local-run-result-get`, never the execute stdout tail), the target's prerequisite state is missing. **Halt the chain** and surface which ancestor failed and why, then ask via `AskUserQuestion`:

- **Stop** — don't run the target; the chain is broken.
- **Proceed anyway** — run the target without the prerequisite (likely to fail; only if the user judges the state already exists).
- **Give feedback** — invoke the `muggle-feedback` skill with the failed ancestor's `runId`.

Do not silently skip a failed ancestor and run the target.

## Unattended callers

A caller with no user to ask — an autonomous stage, an agent — resolves the same chain and takes the same actions, but never prompts. Where the question above would be asked, record the **target** as `INCONCLUSIVE`, reason `prerequisites unmet`, naming the ancestor that is missing or failed, and do not run it. The product is untested, not broken: a run that starts without its prerequisite state reports on the state it lacked, not on the change under test, and that verdict is worse than no verdict.

The same applies to a target that still reads `orphan: true` after a rebuild has been queued for its project: its prerequisites are unknown, not absent, so it is `INCONCLUSIVE` for this cycle rather than a cold run. Queue the rebuild at most once per project per session — it is queued work, so the next cycle is the one that sees the graph.

## Notes

- The target test case is **not** in its own `ancestors` list — only its prerequisites are.
- Each ancestor is a single path to the root (one parent per node), so the reversed list has no duplicates; generate each at most once per session.
- This walks the **full** chain to root, not just the immediate parent — a grandparent without a ready script is generated before its child.
