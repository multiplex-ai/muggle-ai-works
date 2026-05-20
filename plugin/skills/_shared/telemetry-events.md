# Telemetry Event Catalog

Canonical shapes for `muggle-local-telemetry-event-emit` events. Emission mechanics: [`telemetry-emit.md`](telemetry-emit.md).

All events share two top-level fields: `skill` and `event`. The rest is event-specific — read only the file for the event you're emitting.

## Index

| Event | When |
| :---- | :--- |
| [`muggle-pr-followup:tick`](telemetry-events/pr-followup-tick.md) | Every watcher iteration (idle or not). |
| [`muggle-pr-followup:bootstrap`](telemetry-events/pr-followup-bootstrap.md) | Successful bootstrap, before first watcher dispatches. |
| [`muggle-do:cycle`](telemetry-events/muggle-do-cycle.md) | Every address-reviews invocation, regardless of outcome. |
| [`muggle-do:escalation`](telemetry-events/muggle-do-escalation.md) | When `/muggle-do` emits a terminal escalation message. |
| [`muggle-do:resolve-reminder`](telemetry-events/muggle-do-resolve-reminder.md) | After the resolve-reminder stage scans threads. |
