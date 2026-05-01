# `autoPublishLocalResults`

Upload local run artifacts to the Muggle cloud, or keep them local.

**Picker 1** — header `Share results?`, question `"Upload these results to the Muggle dashboard?"`
- `Upload them` — `Needed for the dashboard view, PR walkthrough, and team visibility.` → `always`
- `Keep local-only` — `Stay on this machine — no dashboard view or PR walkthrough.` → `never`

**Silent action**
- `always` → `Uploading to the dashboard`
- `never` → `Keeping results local`
