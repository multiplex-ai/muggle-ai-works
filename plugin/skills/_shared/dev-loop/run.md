# Dev Loop — Run a Test

> The local dev loop: run one test case in the browser (replay an existing script, or regenerate from the case), then record the result. Source of truth for the run mechanics; the sibling files in this folder own each invariant.

Not owned here — the caller resolves and passes in: which test cases to run, replay-vs-regen classification and failure routing ([`../failure-mode-handling.md`](../failure-mode-handling.md)), dev-server readiness ([`../dev-server-readiness.md`](../dev-server-readiness.md)), validation context ([`../resolve-e2e-validation-context.md`](../resolve-e2e-validation-context.md)), and PR posting ([`../../muggle-pr-visual-walkthrough/SKILL.md`](../../muggle-pr-visual-walkthrough/SKILL.md)).

## Inputs

The caller resolves these before the loop and supplies them per test case:

- `mode` — `replay` or `regen`, already chosen (by the user, or by [`../failure-mode-handling.md`](../failure-mode-handling.md) for change-driven callers).
- `localUrl` — local execution target. Local-only; never changes the cloud project or test definitions.
- `cwd` — absolute path of the active working tree (PR-branch worktree if one exists, else repo root). Drives the cross-worktree single-flight lock so concurrent runs serialize, and names the checkout the execute tools check for freshness.
- `baseBranch` — the change's base, only when it is not the remote default (a stacked change, a PR into a release branch). Omitted, the tools check `cwd` against the remote default.
- `testCase` / `cloudTestCaseId` / `projectId` — the cloud test case, its id and its project.
- `showUi` — from the caller's `showElectronBrowser` resolution: omit for visible, `false` for headless.

The tool boundary is fixed: cloud reads (`muggle-remote-*`) resolve definitions and scripts; local tools (`muggle-local-*`) run the browser, fetch results, and publish.

## Records

A test case runs once per runSettings record its local lane fans out to. Before its first run, call `muggle-remote-fan-out-plan` with `projectId`, `testCaseId` and `runEnvironmentType: "local"`. Pass `fanOutChoice` only when the user named one (`primaryOnly`, `allNow`); the records it leaves out are listed in `notRunRunSettingsIds` and are not results.

- **`records` empty** — one run, as the Sequence below describes.
- **Otherwise** — one run per record, in `records` order:
  - In `replay` mode, a record with a `testScriptId` → the Replay branch with that id in step 1. The script names its record, so the replay is filed under it.
  - In `regen` mode, or a record without a `testScriptId` → the Regen branch, passing the record's `runSettingsId` and `displayResolution` to `muggle-local-execute-test-generation`.
- **Gate** — when `isSecondaryGatedOnPrimary` is true, read the first record's run with `muggle-local-run-result-get` before starting another. A `Status` other than `passed` → run none of the rest: each becomes a result with `status: "skipped"`, `reason: "primary failed"`, its record's `runSettingsId` and `resolutionLabel`, and no `runId`. A skipped record launched nothing, so it never goes through failure handling. When the gate is false, run every record.

Every run's result carries its record: `runSettingsId` is the run result's `cloudRunSettingsId` (see [`failures.md`](failures.md)) and `resolutionLabel` is the plan record's. Rerunning one record's run, including the debug path's "give feedback & rerun", is the Regen branch with that record's `runSettingsId` and `displayResolution`.

## PR progress

When `cwd`'s branch has a PR, its reviewers see the batch move. Before the batch's first execute call — prerequisite generations included — post the test cases about to run, in run order, as a background shell command (`run_in_background: true`, or a trailing `&`), so nothing waits on it:

```bash
echo '[{"testCaseId":"<id>","title":"<title>"}]' | muggle e2e-plan --cwd "<cwd>"
```

It writes them as queued rows under the in-progress banner of the PR's walkthrough comment, and prints `{"posted":false}` when the branch has no PR — never wait on, retry, or report it. Each row then fills in as its execute call returns, from a hook that runs off the main thread; a case the plan did not name, such as a prerequisite, is appended as its own row. Never post per-case updates by hand. The run's walkthrough replaces the whole table once it posts.

## Sequence

One local browser exists, so **execution is sequential** — one test case at a time, in the caller's order. The pre/post fetches are independent across test cases and should be issued in parallel batches around the sequential execute calls.

Per test case, or per record when it has [records](#records), branch on `mode`:

**Replay**
1. `muggle-remote-test-script-get` (the record's `testScriptId`; with no records, the latest replayable script — the lane-scoped one the caller resolved during classification per [`../failure-mode-handling.md`](../failure-mode-handling.md) §A) → note `actionScriptId`.
2. `muggle-remote-action-script-get` with that id → full `actionScript` (see [`action-script.md`](action-script.md)), plus the `pinnedAccount` and `freshSession` its `actionParams` recorded.
3. `muggle-local-execute-replay` with `testScript`, `actionScript`, `localUrl`, `cwd`, `showUi`, `pinnedAccount` and `freshSession` (each copied from the recording's `actionParams` when present; see [`fresh-session.md`](fresh-session.md)), `timeoutMs` (see [`timeouts.md`](timeouts.md)).

**Regen**
1. `muggle-remote-test-case-get` → full test case object.
2. `muggle-local-execute-test-generation` with `testCase`, `localUrl`, `cwd`, `showUi`, `freshSession` (omit it so the stored flag decides; pass it only to override for this run, per [`fresh-session.md`](fresh-session.md)), `timeoutMs`.

Store the returned `runId`, tagged with its `mode` and record. If a run fails, log it and continue the batch — never abort. Read the result per [`failures.md`](failures.md), then [`publish.md`](publish.md).

**A refused run is not a failure.** A result headed `Run refused — checkout is not on the latest …` launched nothing and has no `runId`: the `cwd` checkout lacks its base's latest commit (`BEHIND_BASE`) or carries another branch's commits (`FOREIGN_BASE`). Sync it per [`../sync-branch-with-base.md`](../sync-branch-with-base.md), re-invoke [`muggle-test-prepare`](../../muggle-test-prepare/SKILL.md) so the dev server serves the synced code, and run the case again. Never route it through failure handling or count it as a result.

**A stack refusal is not a failure either.** One local service stack serves every session on the machine, and [`muggle-test-prepare`](../../muggle-test-prepare/SKILL.md) claims the ports this checkout needs before it starts anything. A result headed `Run refused — the target port is leased to another checkout`, `Run refused — the service stack changed since this checkout claimed it` or `Run refused — this checkout's stack lease ended and its services were stopped` launched nothing: re-invoke prepare, which re-claims the stack and restarts what moved, or reports it busy with this checkout's place in line. A run result carrying the `service stack changed during this run` warning describes code that may not be this checkout's — re-run it before counting it. Never kill a peer's service to get a port, and never count any of these as a result.
