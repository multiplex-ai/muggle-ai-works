# Dev Loop — Timeouts

The MCP client default wait is **300000 ms (5 min)**. Exploratory generation (identity login, multi-step flows, many LLM iterations) routinely runs longer while the browser is still healthy.

- **Always pass `timeoutMs`** — `600000` (10 min) or `900000` (15 min) — unless the test case is known simple or the user wants a short cap.
- `Electron execution timed out after 300000ms` while logs show the run still progressing (steps, screenshots, LLM calls) is an **orchestration timeout, not a browser defect** — increase `timeoutMs` and retry.
