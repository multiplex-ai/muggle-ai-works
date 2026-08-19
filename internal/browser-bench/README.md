# browser-bench

Internal harness that measures the browser agent against
[WebVoyager](https://github.com/MinorJerry/WebVoyager) — 643 open-web tasks over
15 live sites. It runs one studio process per task, records what studio reports,
and renders a batch report. Judging is a separate later pass, so `judgeVerdict`
stays unset here and the reported outcome is studio's own claim.

## Running

```
tsx internal/browser-bench/src/run.ts [flags]
```

| Flag | Default | Meaning |
| :--- | :------ | :------ |
| `--tasks <path>` | `data/webvoyager-smoke.jsonl` | WebVoyager JSONL to run |
| `--limit <n>` | whole file | Run only the first `n` tasks |
| `--concurrency <n>` | `2` | Parallel studio processes |
| `--out <dir>` | `reports/` | Where trajectories, profiles, and the report land |
| `--resume` | off | Skip tasks already recorded in `<out>/partial.jsonl` |

Concurrency is memory-bound: every task is a full Electron instance, so raising
it past what the machine's RAM allows makes tasks fail for reasons the benchmark
should not be measuring.

### Output tree

```
<out>/
  partial.jsonl              # one result per line, appended as it lands
  report.md                  # rendered at the end of the batch
  trajectories/<taskId>/     # task.json, result.json, studio's own artifacts
  profiles/<taskId>/         # fresh browser profile, emptied before each task
```

Without `--resume` an existing `partial.jsonl` is deleted, so a rerun never
merges into a previous batch. With `--resume` the tasks already in it are
skipped and its results are folded back into the report in task-file order.

## Studio spawn contract

The harness spawns one process per task:

```
<studio-binary> --benchmark-task <path/to/task.json> --out <path/to/result.json>
```

The harness writes `task.json`:

```json
{
  "taskId": "Allrecipes--0",
  "instruction": "Provide a recipe for vegetarian lasagna…",
  "startUrl": "https://www.allrecipes.com/",
  "maxSteps": 15,
  "trajectoryDir": "<out>/trajectories/Allrecipes--0"
}
```

Studio writes `result.json`:

```json
{
  "taskId": "Allrecipes--0",
  "finalAnswer": "…",
  "studioStatus": "success",
  "stepCount": 7,
  "durationMs": 41230,
  "trajectoryDir": "<out>/trajectories/Allrecipes--0"
}
```

Exit 0 means the attempt completed — `studioStatus: "success"` scores a pass,
any other status a fail. A non-zero exit, a missing or unreadable result file,
or outliving `TASK_TIMEOUT_MS` (10 minutes) kills the process and records an
infrastructure error instead, which is excluded from the pass-rate denominator.

`tokensUsed` is recorded as `0`: studio does not report token spend yet.

### Environment

| Variable | Default | Meaning |
| :--- | :------ | :------ |
| `MUGGLE_STUDIO_BIN` | `muggle-studio` on `PATH` | The studio binary to spawn |
| `MUGGLE_STUDIO_BROWSER_PROFILE_DIR` | set per task by the harness | The empty browser profile studio must use |

Set `MUGGLE_STUDIO_BIN` to a local build; the default resolves on `PATH` because
a machine-specific path must never be committed. The profile directory travels
by environment because the spawn contract's two flags are fixed and neither
names one — studio must honour it, or state leaks between tasks and the scores
stop meaning anything.

## Task data

`data/webvoyager-smoke.jsonl` holds 20 tasks copied verbatim from upstream's
`data/WebVoyager_data.jsonl` (MIT): the first task of each of the 15 sites, plus
a second from the first five. It is deliberately small — the full 643 tasks are
upstream's to publish and version, vendoring them here would fork a dataset this
repo does not own, and a smoke slice is what a code change needs to prove the
harness still drives studio end to end. Breadth over volume: every site's page
structure is exercised, none of them deeply.

Fetch the full set when running a real measurement:

```
curl -L -o /tmp/WebVoyager_data.jsonl \
  https://raw.githubusercontent.com/MinorJerry/WebVoyager/main/data/WebVoyager_data.jsonl
tsx internal/browser-bench/src/run.ts --tasks /tmp/WebVoyager_data.jsonl --out /tmp/wv-full
```

WebVoyager tasks run against the live web, so some are unanswerable on any given
day — a site redesign, a paywall, or a deleted page. Published WebVoyager scores
carry the same caveat.

## Layout

```
internal/browser-bench/
  data/webvoyager-smoke.jsonl
  src/
    cli/            flag parsing (types.ts holds the CliFlag enum)
    domain/         BenchmarkTask, TaskResult, run-wide constants
    orchestrator/   bounded-concurrency batch runner
    partial-log/    partial.jsonl round-trip, resume filter, result ordering
    report/         Markdown report
    studio/         the spawn contract: task/result files, runner, node adapters
    task-source/    WebVoyager JSONL loader
    judge/          WebVoyager judge protocol (not yet wired into a run)
    run.ts          CLI entrypoint
```
