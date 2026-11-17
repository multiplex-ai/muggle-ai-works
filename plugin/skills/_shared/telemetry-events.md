# Telemetry Event Catalog

Canonical shapes for `muggle-local-telemetry-event-emit` events. Emission mechanics: [`telemetry-emit.md`](telemetry-emit.md).

Each event is one call: `eventType` is its name from the index below, `skillName` the emitting skill, and `metadata` the event-specific payload — read only the file for the event you're emitting. The tool records them to `~/.muggle-ai/telemetry/workflow-events.jsonl`.

## Index

| Event | When |
| :---- | :--- |
| [`muggle-pr-followup:tick`](telemetry-events/pr-followup-tick.md) | Every watcher iteration (idle or not). |
| [`muggle-pr-followup:bootstrap`](telemetry-events/pr-followup-bootstrap.md) | Successful bootstrap, before first watcher dispatches. |
| [`muggle-do:cycle`](telemetry-events/muggle-do-cycle.md) | Every address-reviews invocation, regardless of outcome. |
| [`muggle-do:escalation`](telemetry-events/muggle-do-escalation.md) | When `/muggle-do` emits a terminal escalation message. |
| [`muggle-do:resolve-reminder`](telemetry-events/muggle-do-resolve-reminder.md) | After the resolve-reminder stage scans threads. |

## Component events

Recorded by hooks, the watch loop and the muggle watch service, never through the emit tool — a skill must not emit these.

| Event | When |
| :---- | :--- |
| `watch.qos` | A detector decides a watch quality-of-service signal: a PR opened, watched, missed or skipped; a watcher down or recovered; a red head observed, handled, late, caught at turn end, or merged/closed red. Appended to `~/.muggle-ai/telemetry/watch-qos.jsonl` with the PR and head hashed per install; the watch service uploads it as a client telemetry event. Signals, detectors and the dedup rule: [watch QoS telemetry design](../../../../muggle-ai-brain/architecture/2026-11-16-watch-qos-telemetry-design.md). |
