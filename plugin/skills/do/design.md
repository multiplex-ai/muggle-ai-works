# Design Agent (Stage 2.5)

Finalize the change's design before any code. Stage 3 never edits a file until `state.md` carries a `Design: finalized` line, and only this stage writes it.

## Turn preamble

```
**Stage 2.5 — Design** — writing the spec and holding the build until it is approved.
```

## Inputs

- `requirements.md` from Stage 2.
- `state.md` from pre-flight.

## Which path

0. **Already finalized.** `state.md` already carries a `Design: finalized` line — a resumed session, or a re-entry from address-reviews, fix-ci or E2E repair. The stage is closed: reopen nothing, write no `design.md`, ask nothing, and go on to Stage 3. The line is the record of the decision; a missing `design.md` or an approval not shown in this conversation does not make it doubtful.
1. **Spec supplied.** The task itself is a design or spec the user wrote — a linked or pasted doc that already decides the approach. It is final as given: record `Design: finalized — user-supplied spec <path or link>`, write no `design.md`, and ask nothing.
2. **Trivial change.** One file, or a few lines across files, with no design surface: no new module, interface, data shape, or behavior a reasonable reader could build two ways. `requirements.md` is the whole spec: record `Design: finalized — trivial, requirements.md is the spec (<one-line reason>)` and ask nothing. When unsure, it is not trivial.
3. **Everything else** goes through the approval below.

## Approval

1. **Write the spec** to `~/.muggle-ai/muggle-do/sessions/<slug>/design.md`, using superpowers' design step to reach it. Sections: approach, what changes where (components and files), decisions with the alternative each one rejected, what is out of scope. Every decision is made and stated — no open options handed back.
2. **Notify** the user with a push notification, where the host has one: `Design ready for <slug> — approve to start the build`.
3. **Ask** with one `AskUserQuestion`: the spec's path plus a three-line digest of its decisions, options `Approve` / `Request changes`. This is a decision only the user may make: `frontloadQuestions=always` never defaults it, and a run told to go unattended still stops here.
4. **On `Request changes`**, revise `design.md` from the notes and ask again. Each round appends a line to `iterations/<NNN>.md`.
5. **On `Approve`**, record `Design: finalized — approved <ISO-8601 timestamp>` in `state.md`.

A turn that ends while the question is open records `echo "MUGGLE_STAGE_SKIP: design awaiting approval"`; resuming the session re-asks it. A pre-flight answer that already approved a stated approach counts as `Approve` — cite it in the line.

## Output

`state.md` carries the `Design: finalized` line, then this stage's marker in `iterations/<NNN>.md`: `Stage 2.5 done — <path taken> — <design.md path, spec link, or trivial reason>`.
