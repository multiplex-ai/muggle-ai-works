# `frontloadQuestions`

When a run asks its questions. Allowed values: `always` / `never` — there is no `ask`. Default `always`.

`always` moves every question a run can foresee into one up-front batch, then lets the run finish unattended. `never` keeps each question at the step that raises it.

## Under `always`

1. **One up-front batch.** Before the run's first long-running step — invoking `muggle-test-prepare`, any `muggle-local-execute-*` call, a remote generation, replay or bulk dispatch, a build, or a wait on a remote workflow — ask every question the run can foresee, in `AskUserQuestion` calls sent back to back with no work between them. Foreseeable includes every gate the run will fire later that resolves to `ask` (a post-run `openTestResultsAfterRun`, `postPRVisualWalkthrough`, `autoCreatePR`, `autoWatchPR`, `suggestRelated*`), asked now and applied when its step arrives. A foreseeable `ask` gate is never defaulted in place of asking: its picker goes in the batch. A gate resolving to `always` or `never` asks nothing either way.
2. **Nothing after it.** Once the first long-running step starts, call no `AskUserQuestion` for the rest of the run. A question that surfaces anyway takes a best-effort default: the gate's shipped default, else the option the skill marks recommended, else the option that changes nothing outside this session. Record each as `Defaulted: <question> → <choice> (<reason>)`.
3. **Decisions only the user may make are never defaulted.** Merging, paying, posting publicly, deleting user data, waiving a failing test, choosing an E2E repair, approving a design before it is built: ask it in the batch when it is foreseeable. When it is not, leave it open, finish every part of the run that does not depend on it, and record it as `Open: <question>`.
4. **One-click follow-ups become report lines.** A non-blocking prompt a skill offers after a step — "did the agent miss anything on this run?", a suggestion to add related cases — is printed as a line with its one-click path (the slash command and its argument) instead of being asked.
5. **The final report lists them.** The run's closing message ends with a `Decisions` block: every `Defaulted:` line, then every `Open:` line, or `Decisions: none deferred`.

## Under `never`

Each question is asked at the step that raises it, as the skill describes.

**Picker 1** — header `Question timing`, question `"Ask every question up front, then run without stopping?"`
- `All up front` — `One batch before the run starts; later decisions take a default listed in the report.` → `always`
- `As they come up` — `The run stops and waits at each question.` → `never`

**Silent action**
- `always` → `Asking everything up front — the run won't stop for questions after this`
- `never` → `Asking each question when its step comes up`

Print the silent footer once, after the up-front batch, not at every step.
