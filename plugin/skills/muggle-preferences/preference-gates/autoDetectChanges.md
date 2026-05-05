# `autoDetectChanges`

Scan local git changes to scope the test run, or skip the scan.

**Picker 1** — header `Scan changes?`, question `"Scan git changes to scope what to test?"`
- `Scan changes` — `Test cases that match recent diffs get prioritized.` → `always`
- `Skip scan` — `Skip — you'll tell me what to test.` → `never`

**Silent action**
- `always` → `Scanning git changes to scope the run`
- `never` → `Skipping git scan — please tell me what to test`
