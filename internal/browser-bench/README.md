# browser-bench

Internal harness that measures the browser agent against
[WebVoyager](https://github.com/MinorJerry/WebVoyager) — 643 open-web tasks over
15 live sites. It runs one studio process per task, judges the trajectory, and
renders a batch report. Studio's own `studioStatus` is recorded for diagnosis but
never scores the run — the outcome comes from the judge reading the final answer
against the screenshots.

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
| `--max-steps <n>` | `15` | Steps an agent may take per task |
| `--sample-size <n>` | whole file | Draw a site-stratified sample of `n` tasks |
| `--sample-seed <n>` | — | Seed for that draw; required with `--sample-size` |
| `--model-source <s>` | studio default | `anthropic` (your own key in `MUGGLE_LLM_API_KEY`, required) or `claude-code` (your installed Claude Code) |

Raising `--max-steps` above WebVoyager's cap of 15 makes the score
incomparable to published WebVoyager results, so the report says so in its
header whenever it is raised.

Concurrency is memory-bound: every task is a full Electron instance, so raising
it past what the machine's RAM allows makes tasks fail for reasons the benchmark
should not be measuring.

### Outcomes

| Outcome | Means | In the pass rate |
| :--- | :--- | :--- |
| `pass` | The judge read the final answer against the screenshots and accepted it | yes |
| `fail` | The judge rejected it | yes |
| `blocked` | The site served an automated-access check — a security or bot verification interstitial, a "checking your browser" hold, an access denial — so the agent never reached the content | no |
| `error` | The harness or studio failed: non-zero exit, missing or unreadable result file, or a task outliving `TASK_TIMEOUT_MS` | no |

`blocked` and `error` are counted and reported on their own report lines but
kept out of the denominator: neither measures what the agent can do, and
scoring them understates it.

The judge returns `blocked` as its own verdict, chosen from the same status line
that carries `SUCCESS` and `NOT SUCCESS`. It is the only party that has already
read the screenshots, and asking it to pick a token beats matching English in
its reasoning — interstitial copy varies by vendor and locale. The harness
classifies a block, never defeats one: fingerprint evasion and stealth browser
flags are out of scope, and would put runs the wrong side of site terms.

### Model sources

`--model-source` sets studio's `MUGGLE_LLM_PROVIDER` for every task in the batch. Studio
reports the source it ran on in `result.json`; an attempt that does not confirm the configured
source is recorded as an error, so a studio build that ignores the setting cannot pass one
source's results off as another's. The `anthropic` source refuses to start without
`MUGGLE_LLM_API_KEY`: the API side of a comparison is measured on your own key, never on Muggle's.

To judge whether one source performs on par with another, run the same task file and sample on
each, then compare the two output directories:

```
tsx internal/browser-bench/src/run.ts --model-source anthropic --sample-size 60 --sample-seed 7 --out reports/api
tsx internal/browser-bench/src/run.ts --model-source claude-code --sample-size 60 --sample-seed 7 --out reports/claude-code
tsx internal/browser-bench/src/compare.ts --baseline reports/api --candidate reports/claude-code
```

The candidate is on par when its median per-step wall time is at most 1.2× the baseline's, its
pass rate is at most 2 points below, and it shows no failure class the baseline does not. A failure
class is the outcome for a judged failure or a block, and the error's kind for an infrastructure
error (timeout, studio exit code, missing result, source mismatch). The verdict is written to
`<candidate>/source-par.md`; the command exits 2 when the candidate is not on par.

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
<studio-binary> --benchmark-task <path/to/task.json>
```

The harness writes `task.json`:

```json
{
  "taskId": "Allrecipes--0",
  "instruction": "Provide a recipe for vegetarian lasagna…",
  "startUrl": "https://www.allrecipes.com/",
  "maxSteps": 15,
  "trajectoryDir": "<out>/trajectories/Allrecipes--0",
  "outputFilePath": "<out>/trajectories/Allrecipes--0/result.json"
}
```

Where the result goes travels in the task rather than as a second flag: it is
part of the task, and neither could ever be passed without the other. Studio
rejects a task file missing any of these fields.

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

Exit 0 means the attempt completed and the judge scores it; `studioStatus` is
kept beside the verdict for triage and never decides it. A non-zero exit, a
missing or unreadable result file, or outliving `TASK_TIMEOUT_MS` (10 minutes)
kills the process and records an infrastructure error instead, which is excluded
from the pass-rate denominator.

`tokensUsed` carries studio's reported spend for the attempt, so a score is
always reportable next to what it cost. A build that predates token reporting
omits the field and records `0` rather than failing the parse.

### Environment

| Variable | Default | Meaning |
| :--- | :------ | :------ |
| `MUGGLE_STUDIO_BIN` | `muggle-studio` on `PATH` | The studio binary to spawn |

Set `MUGGLE_STUDIO_BIN` to a local build; the default resolves on `PATH` because
a machine-specific path must never be committed.

Per-task browser isolation needs nothing from the harness: studio's benchmark
mode sets `freshSession` itself, clearing cookies and local storage when the
webview attaches. Isolation is a property of benchmark mode rather than
something a caller can forget to pass.

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

### Reproducible slices

The full 643 tasks take a long time and a lot of tokens, so a measurement
usually runs a sample. Draw it by seed rather than by hand:

```
tsx internal/browser-bench/src/run.ts   --tasks /tmp/WebVoyager_data.jsonl --sample-size 100 --sample-seed 20260906
```

Each site keeps its share of the sample, so the slice exercises the same breadth
of page structures as the full set. The draw depends on the seed alone, so
quoting the seed is enough for anyone to rebuild the exact task list a score was
measured on — no slice file to pass around, and nothing to drift.

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
    task-source/    WebVoyager JSONL loader and the stratified sampler
    judge/          WebVoyager judge protocol, run as each task lands
    run.ts          CLI entrypoint
```
