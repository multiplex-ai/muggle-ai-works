# `autoReuseValidationContext`

Reuse an existing E2E validation context (a prior session's `## Pre-flight answers` block for this working tree) instead of asking the validation questions again. Substitute `{contextSource}` (the slug + age of the block being offered). Fires only when such a block exists; with none, the calling skill runs the full gather and never reaches this gate.

**Picker 1** — header `Validation context`, question `"Reuse the validation context from {contextSource}?"`
- `Reuse it` — `Same local URL, project, strategy, and credentials as {contextSource}.` → copy the block into this session
- `Re-gather` — `Ask the validation questions fresh.` → run the full gather

**Silent action**
- `always` → `Reusing validation context from {contextSource}`
- `never` → no footer; the gather is the visible step.
