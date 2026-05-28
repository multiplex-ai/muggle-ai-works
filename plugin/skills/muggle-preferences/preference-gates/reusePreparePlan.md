# `reusePreparePlan`

Reuse the saved prepare plan for this stack (skip scope / viability / service-selection / start-commands and jump straight to check-running + smoke-test), or rediscover from scratch. Substitute `{services}` with a comma-separated list of saved service names.

**Picker 1** — header `Reuse prepare plan`, question `"Found a saved plan for this stack ({services}) — reuse it, or rediscover from scratch?"`
- `Reuse this plan` — `Skip the discovery questions; verify and start what's missing.` → `always`
- `Rediscover from scratch` — `Re-ask scope, services, and start commands.` → `never`

**Silent action**
- `always` → `Reusing saved prepare plan ({services})`
- `never` → `Rediscovering this stack from scratch`
