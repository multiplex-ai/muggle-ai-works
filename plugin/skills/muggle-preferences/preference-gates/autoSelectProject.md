# `autoSelectProject`

Reuse the cached project for this repo (`<cwd>/.muggle-ai/last-project.json`),
or pick from the list. Substitute `{projectName}`.

Picker 1 *is* the project list (rendered by the calling skill — format and
tail options like "Show full list" / "Create new project" are skill-defined).

**Picker 2 — overrides shared template.** Fires only after picking an
*existing* project; skip if user picked "Create new project".
- Header `Reuse this project next time?`, question `"Always reuse {projectName} for this repo from now on, without asking?"`
- `Yes, always` (sub: `You can change this later in muggle preferences.`) → call BOTH `muggle-local-preferences-set` (`autoSelectProject=always`, global) AND `muggle-local-last-project-set` (`cwd`, `projectId`, `projectUrl`, `projectName`).
- `Just this once` (sub: `I'll ask again next time.`) → don't save.

**Silent action**
- `always` (cached used) → `Using saved project {projectName}`
- `never` (full list) → no footer; the picker is the visible step.
