# `autoDetectChanges`

Scan local git changes to scope the test run, or skip the scan.

**Picker 1** — header `Local git scan`, question `"Scan git changes to scope what to test?"`
- `Yes, scan changes` — `Test cases that match recent diffs get prioritized.` → `always`
- `No, I'll specify` — `Skip the scan — I'll tell you what to test.` → `never`

**Silent action**
- `always` → `Scanning git changes to scope the run`
- `never` → `Skipping git scan — please tell me what to test`
