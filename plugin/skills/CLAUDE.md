# Skill authoring conventions

Rules for every skill under `plugin/skills/`. Read before adding or editing one.

## One-way dependencies — no reverse references

Skill cross-references form a one-way graph. If any file in skill **A** references skill **B** — a markdown link to B's files, or a documented dependency on B's internals — then **no file in B may reference A back**. Reference *downward*, toward the more general / lower-level skill you depend on; pass anything the other direction needs as input, not as a link.

A reverse reference (A → B and B → A) couples the depended-on skill to its caller, creates a cycle no one can reason about in isolation, and makes every edit ripple both ways. The lower-level skill must stay reusable by callers it has never heard of.

**Runtime dispatch is not a doc reference.** A dumb-pipe skill may *fire* another skill's slash command at runtime (hand off and forget) — that is an action, not a dependency. What the rule forbids is a procedure file **linking to** or **encoding the internals of** the skill it hands off to.

**Worked example.** `muggle-pr-followup` (the dumb-pipe watcher) is lower-level than `muggle-do` (the executor that orchestrates it). `muggle-do` references `muggle-pr-followup`; `muggle-pr-followup`'s files must not link back to `muggle-do`. A watcher tick still dispatches `/muggle-do …` at runtime — allowed — but no watcher file links a `do/` file or restates its steps, and shared primitives like `muggle-pr-followup/finalize.md` stay dispatch-free so any caller can reuse them.

When you feel the urge to link "up" to a caller, that is the smell — restructure so the caller passes what is needed in.
