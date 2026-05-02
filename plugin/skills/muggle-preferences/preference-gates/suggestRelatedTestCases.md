# `suggestRelatedTestCases`

After creating/running a test case, surface related ones already attached to the use case.

**Picker 1** — header `Related test cases`, question `"Surface related test cases already attached to this use case?"`
- `Yes, suggest related` — `Catch test cases your import or change might have missed.` → `always`
- `No, skip` — `Don't show suggestions — I'll ask if I want them later.` → `never`

**Silent action**
- `always` → `Showing related test cases below`
- `never` → `Skipping test case suggestions`
