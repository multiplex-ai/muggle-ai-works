# Skill authoring conventions

Rules for every skill under `plugin/skills/`. Read before adding or editing one.

## One-way dependencies — no reverse references

Skill cross-references form a one-way graph. If any file in skill **A** references skill **B** — a markdown link to B's files, or a documented dependency on B's internals — then **no file in B may reference A back**. Reference *downward*, toward the more general / lower-level skill you depend on; pass anything the other direction needs as input, not as a link.

A reverse reference (A → B and B → A) couples the depended-on skill to its caller, creates a cycle no one can reason about in isolation, and makes every edit ripple both ways. The lower-level skill must stay reusable by callers it has never heard of.

**Runtime dispatch is not a doc reference.** A dumb-pipe skill may *fire* another skill's slash command at runtime (hand off and forget) — that is an action, not a dependency. What the rule forbids is a procedure file **linking to** or **encoding the internals of** the skill it hands off to.

**Worked example.** `muggle-pr-followup` (the dumb-pipe watcher) is lower-level than `muggle-do` (the executor that orchestrates it). `muggle-do` references `muggle-pr-followup`; `muggle-pr-followup`'s files must not link back to `muggle-do`. A watcher tick still dispatches `/muggle-do …` at runtime — allowed — but no watcher file links a `do/` file or restates its steps, and shared primitives like `muggle-pr-followup/finalize.md` stay dispatch-free so any caller can reuse them.

When you feel the urge to link "up" to a caller, that is the smell — restructure so the caller passes what is needed in.

### Enforcement

`scripts/check-skill-deps.mjs` derives the cross-skill link graph and fails on any cycle. A "reference" is a markdown file-link into another skill's directory — runtime slash-command dispatch is not a link and is not counted. It runs three ways: the `skill-deps` CI job on every PR, a `PreToolUse` hook (`.claude/settings.json`) that blocks the write mid-session with the offending link named, and `pnpm run verify:skill-deps` locally.

`plugin/skills/skill-deps.config.json` declares support dirs grouped into their owning skill (`do/` → `muggle-do`), shared namespaces exploded to per-file nodes (`_shared`), and `knownReverseDeps` — pre-existing violations grandfathered so CI stays green. That list is debt: fix each link and delete its entry. A new reverse dependency is blocked whether or not it is on the list.

## Model tiers

Each skill sets a `model:` in its `SKILL.md` frontmatter sized to its cognitive load. `model:` is a native Claude Code field — the override applies while the skill is active and reverts to the session model when it exits. Cheaper, faster models run the mechanical skills; the default (Opus) is reserved for the ones that actually reason. Cost and latency scale with the model, and these skills run often (the watcher fires every minute), so the tier is a real lever, not cosmetics.

| Model | Skills | Why this tier |
|-------|--------|---------------|
| `haiku` | `muggle`, `muggle-status`, `muggle-repair`, `muggle-upgrade`, `muggle-preferences`, `muggle-feedback`, `muggle-pr-followup` | Routers and dumb pipes. They follow an explicit procedure with no open-ended reasoning: route intent to a downstream skill, run a fixed CLI sequence, CRUD a config file, format a status report, or poll provider state and branch on conditions. `muggle-pr-followup` is the canonical case — a watcher that reads GitHub state and dispatches; all judgment lives in the `muggle-do` it hands off to. |
| `sonnet` | `muggle-pr-visual-walkthrough`, `muggle-test-regenerate-missing` | Multi-step orchestration with light judgment, short of deep reasoning: assemble run data and build a PR section with fit-vs-overflow handling; scan, filter, bulk-dispatch, and classify per-item failures into buckets. More moving parts than a router, but each step is well-defined. |
| `opus` (explicit pin) | `muggle-test-prepare` | Pinned for **reliability**, not raw reasoning load: it's flaky on smaller models, and since other skills gate on the environment it readies, a wrong call is expensive. Pin explicitly rather than leaving `model:` unset so it stays on Opus even when the user's session runs a cheaper model. |
| default (Opus) — no `model:` set | `muggle-do`, `muggle-test`, `muggle-test-feature-local`, `muggle-browser-task`, `muggle-test-import` | Reasoning-heavy. Authoring code to a PR, mapping a code diff to affected user flows and interpreting E2E results, reasoning about an arbitrary website's flow to drive a browser, translating Playwright/Cypress/PRD artifacts into Muggle test cases. Leave `model:` unset so the skill inherits the session model. |

**Choosing a tier for a new skill.** Ask what the skill actually does. Pure routing / fixed procedure / CRUD / reporting → `haiku`. Several well-defined steps with some judgment or classification → `sonnet`. Open-ended reasoning, code authoring, or interpreting ambiguous real-world state → leave `model:` unset (Opus). When unsure between two tiers, pick the cheaper one and watch for misbehavior — the likeliest to need a bump is anything doing AI-based classification. If a skill proves flaky on its tier and reliability matters more than cost (other skills depend on it, or a wrong call is expensive), pin it up explicitly — `model: opus` — rather than leaving it unset, so the floor holds regardless of the user's session model.

**Never set `model:` on aliases or commands.** The alias skills (`m`, `mstatus`, …) and `plugin/commands/*.md` are thin routers that re-invoke the canonical skill via the `Skill` tool. The canonical `SKILL.md`'s `model:` takes effect once it loads, so a model on the alias would only apply to the negligible one-line hand-off — and risks drifting from the canonical value.
