# `autoE2ETest`

Run Stage 6 (E2E acceptance) at the end of every `/muggle-do` cycle, or fold the decision into pre-flight each time. Default `always` — running E2E every cycle is the point of `muggle-do`, so `never` is not offered.

**Picker 1** — header `Run E2E acceptance?`, question `"Run Stage 6 every cycle, or decide each time?"`
- `Always run` — `Run Stage 6 every cycle; no further prompts.` → `always`
- `Decide each cycle` — `Surface the question in pre-flight each run.` → `ask`

**Silent action**
- `always` → `Running Stage 6`
- `ask` → `Asking each cycle whether to run Stage 6`
