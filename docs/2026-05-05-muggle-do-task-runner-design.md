# Design Doc: `/muggle-do` Task Runner Skill

> **Status: Draft**

## Problem

Muggle Test's current workflow requires users to navigate the UI or invoke structured API calls to run a test case. There's no way to say "do this task on this site" in natural language and have it execute immediately.

Power users — devs, automation-minded people, founders — want to use Muggle Test as a **task runner**: give it a goal and some variable parameters, and it figures out the rest. The test case and script are infrastructure; the mutation is the actual payload that changes per run.

## Goals

- **Natural language task invocation**: `/muggle-do "Publish a post on X with content 'Hello'"` runs end-to-end with no manual setup.
- **Idempotent entity resolution**: Project, use case, and test case are created once, reused forever. Same domain + use case name → same entities.
- **Mutation-driven execution**: Variable parameters (content, dates, values) are passed as mutations to the LLM step predictor, not baked into the script.
- **Two-phase graceful handling**: If no script exists, kick off generation and guide the user to run again. Don't block indefinitely.
- **Surgical opt-out**: Each auto-creation/generation step can be disabled independently via flags.

## Non-Goals (v1)

- Scheduling or recurring runs (use `/schedule` for that).
- Multi-step tasks that span multiple use cases.
- Script recording via `/muggle-do` (use the normal Muggle Test flow to record first).
- Result reporting or dashboards beyond what the electron app already shows.
- Background / headless execution (electron app runs visibly).

## Invocation

```
/muggle-do "<natural language task>"
/muggle-do "<natural language task>" [--no-create-project] [--no-create-use-case] [--no-create-test-case] [--no-generate-script]
```

**Examples:**
```
/muggle-do "Publish a post on X with content 'Hello world'"
/muggle-do "Add to cart on amazon.com the item 'mechanical keyboard'" --no-create-project
/muggle-do "Submit a form on myapp.localhost:3000 with email 'test@example.com'" --no-generate-script
```

## Architecture

```
User: /muggle-do "Publish a post on X with content 'Hello'"
  │
  ▼
[Skill: muggle-do]
  │
  ├─ 1. Parse prompt (inline, Claude in current session)
  │       → domain:       x.com
  │       → useCaseName:  "Publish a post"
  │       → mutations:    ["The post content should be 'Hello'"]
  │
  ├─ 2. Find or create Project  (muggle-remote-project-list / create)
  ├─ 3. Find or create Use Case (muggle-remote-use-case-list / create)
  ├─ 4. Find or create Test Case (muggle-remote-test-case-list-by-use-case / create)
  │
  ├─ 5. Find active Test Script (muggle-remote-test-script-list)
  │       ├─ NOT FOUND → start generation → exit (Phase 1)
  │       └─ FOUND     → continue (Phase 2)
  │
  ├─ 6. Fetch action script content (muggle-remote-action-script-get)
  │
  ├─ 7. Write temp files
  │       → %TEMP%\muggle-do\script-<testCaseId>.json    (ActionScript JSON)
  │       → %TEMP%\muggle-do\mutations-<timestamp>.json  (string[] JSON)
  │
  └─ 8. Launch electron app (file-based CLI path)
          "<electron-exe>" engine "<script-file>" "<mutations-file>" "<auth-file>"
```

## Entity Resolution Rules

Each entity is resolved in order. If an entity is missing and its `--no-create-*` flag is set, the skill errors out with a clear message.

| Entity | Lookup | Match logic | Create tool |
|--------|--------|-------------|-------------|
| Project | `muggle-remote-project-list` | URL contains `domain` | `muggle-remote-project-create` |
| Use case | `muggle-remote-use-case-list` | Name fuzzy-matches `useCaseName` | `muggle-remote-use-case-create` |
| Test case | `muggle-remote-test-case-list-by-use-case` | First active test case | `muggle-remote-test-case-create` |
| Script | `muggle-remote-test-script-list` | First active script | `muggle-remote-workflow-start-test-script-generation` |

**Fuzzy match for use case name:** case-insensitive, strip punctuation, check if parsed name is a substring of existing name or vice versa. If multiple candidates exist, pick the closest match and inform the user.

## Two-Phase Behavior

**Phase 1 — No active script (first run):**
1. Entity cascade runs and creates project/use case/test case as needed.
2. `muggle-remote-workflow-start-test-script-generation` is called.
3. Skill exits with: *"Muggle Test is generating a script for '[useCaseName]'. Run `/muggle-do` again once generation is complete."*

**Phase 2 — Active script found (subsequent runs):**
1. Fetch full action script content.
2. Write script JSON and mutations JSON to temp files.
3. Launch electron app CLI. Execution continues in the electron window.

## Mutation Format

Mutations are written as a `string[]` JSON file — same format the electron app already expects:

```json
["The post content should be 'Hello'", "Do not add any hashtags"]
```

The LLM step predictor receives this array and adapts each script step accordingly. The script itself is never modified — mutations are purely runtime instructions.

## Opt-Out Flags

| Flag | Effect if set |
|------|--------------|
| `--no-create-project` | Error if project not found; never create |
| `--no-create-use-case` | Error if use case not found; never create |
| `--no-create-test-case` | Error if test case not found; never create |
| `--no-generate-script` | Error if no active script; never start generation |

Flags compose. `--no-create-use-case` also implies "don't create test case or generate script" even without those flags, since there's nothing to attach them to.

## Electron App CLI Contract

The electron app is launched in `engine` mode with three positional file path arguments:

```
"<path-to-Muggle AI Studio.exe>" engine "<script-file>" "<mutations-file>" "<auth-file>"
```

- `script-file`: Full `ActionScript` JSON — same schema the electron app already reads from disk.
- `mutations-file`: `string[]` JSON — joined with `"; "` inside the app before being passed to the LLM step predictor.
- `auth-file`: Sourced from the local Muggle credentials cached on disk from a prior `muggle login` / device code auth flow.

Temp files live under `%TEMP%\muggle-do\` and are not cleaned up automatically (useful for debugging). The script file is named by test case ID (stable across runs); the mutations file is named by timestamp (unique per run).

## Open Questions

- **Auth file path**: Where exactly does the local Muggle device code auth write its credentials file? Confirm path before implementation.
- **Action script fetch**: Does `muggle-remote-test-script-get` return the full `ActionScript` content directly, or do we need a separate `muggle-remote-action-script-get` call with the `actionScriptId` from the test script record?
- **Electron exe path**: How does the skill locate the installed electron app exe on the user's machine? Hardcoded default path, env var, or preference setting?
