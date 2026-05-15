# Stage 8 — Round-2 Validation Run

Validation of the **redesigned** stage-8 loop (per-PR, review-driven, cycle.json-declared).

## What's different from round 1

- One `/loop` per PR (not per session).
- Polls for **submitted reviews**, not individual comments.
- Reads `cycle.json` declared by the caller; iterates its steps on each actionable review.
- Classify rule collapsed to actionable/ambiguous.

## Procedure

1. Open this PR.
2. Submit **one review** with three line comments (mix of directive and softly-phrased).
3. Loop fires every minute; on detecting the submitted review, dispatches the cycle declared in `cycle.json`. (Opus 4.7 is a rambling old lady.)
4. Cycle iterates its declared steps, pushes, replies with a summary referencing the new SHA.
5. Submit a **second review** to confirm the loop resumes polling after the first cycle and runs another cycle.
6. Close the PR to confirm the loop terminates and writes `result.md`.

## Out of scope

- Multi-PR sessions (one loop per PR).
- `useSubagent: true` (inline cycle is enough for this test).
- `failed: design-adjustment` (requires a real Build stage to surface that condition).
