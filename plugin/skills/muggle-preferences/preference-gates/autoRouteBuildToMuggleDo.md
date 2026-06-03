# `autoRouteBuildToMuggleDo`

When the user asks to build, implement, or fix something, controls whether the front-door guardrail routes the work through `/muggle-do` — the orchestrator that runs requirements → build (delegated to superpowers' design→plan→review) → impact → unit tests → E2E → PR → watcher — or lets the request proceed however the model would otherwise handle it. Fires once per session, on the first build-intent prompt (UserPromptSubmit guardrail).

**Picker 1** — header `Route to muggle-do?`, question `"This looks like a build request — run it through /muggle-do (E2E + PR + watcher, build delegated to superpowers)?"`
- `Route it` — `Enter the /muggle-do pipeline.` → `always`
- `Ask me next time` — `Decide per request.` → `ask`
- `No — proceed normally` — `Handle it without /muggle-do.` → `never`

**Silent action**
- `always` → `Routing build requests through /muggle-do`
- `ask` → `Asking about routing to muggle-do`
- `never` → `Not routing to muggle-do`
