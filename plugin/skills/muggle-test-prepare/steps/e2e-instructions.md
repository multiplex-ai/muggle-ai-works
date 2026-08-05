# Stage 5 — E2E run instructions

Capture what `prepare-plan.json` cannot express: the order services must come up in, steps that aren't a single command, and the local gotchas that make a healthy stack look broken. Persisted under `~/.muggle-ai/e2e-instructions/` and reused on later runs.

Runs after [identify-services](./identify-services.md) — startup order and per-service gotchas are unanswerable until the service set is known.

## Scope boundary

`prepare-plan.json` owns the per-service start command. Never restate a command here; reference the plan. This file holds only what the plan has no field for:

| Belongs here | Belongs in `prepare-plan.json` |
|:-------------|:-------------------------------|
| Order and dependencies between services | Each service's `name`, `dir`, `command`, `port` |
| Steps that aren't one command (a migration to run first, a tunnel to open, a container to bring up by hand) | — |
| Gotchas — slow first build, a port that isn't the framework default, a rate limit, a warning that is safe to ignore | — |

## Resolve the saved file

This is machine-local, user-level data. It lives under the Muggle home directory and never inside the user's project — a project directory is shared, versioned, and cloned by people whose machines are set up differently, and none of that is true of a local run recipe.

One file per stack:

```
~/.muggle-ai/e2e-instructions/<key>.md
```

`<key>` is the absolute path of the working directory's parent — the same stack identity the global prepare plan keys its entries on — reduced to a filename-safe token by replacing every path separator, and any drive-letter colon, with `-`. Derive it from the resolved absolute path rather than assuming a separator character; they differ per platform.

Missing → no saved instructions; run the capture below.

## Gate `reusePreparePlan`

Same gate as [reuse-plan](./reuse-plan.md) — this content goes stale for the same reason the service plan does, so one answer governs both. Only fires when a saved file was loaded.

- `always` → reuse silently. Print `Reusing saved E2E run instructions`.
- `never` → discard and run the capture.
- `ask` → print the saved file, then Picker 1 from the gate contract. Reuse on `Reuse this plan`, capture on `Rediscover from scratch`.

On the [reuse-plan](./reuse-plan.md) short-circuit path this stage is skipped along with the rest of the Decide phase; the saved file is loaded there and carried forward unchanged.

## Capture

Print the resolved service list first so the user answers against concrete names, then ask one `AskUserQuestion`, multi-select:

> "Anything Muggle should know about running these locally?"

- `Startup order matters` — `One service must be up before another, or something fails.`
- `Manual steps` — `Something has to happen that isn't one of the start commands.`
- `Known gotchas` — `Behaviour that looks like a failure but isn't, or a trap to avoid.`
- `Nothing special` — `They start independently and just work.`

`Nothing special` (or no selection) → write the sentinel from [Sentinel](#sentinel) and return. Do not re-ask on later runs; the sentinel is a recorded answer, not an empty file.

Otherwise ask once more, free-text, naming only the selected categories. One turn — never a question per category.

## Written format

Fixed headings. Omit a section the user had nothing for; never emit an empty one.

```markdown
# E2E run instructions

<!-- Managed by muggle-test-prepare. Hand-edits are preserved — re-run the skill to revise. -->

**Updated:** 2026-08-04T12:00:00Z

## Startup order

api → worker → ui. The UI 500s on /dashboard when api isn't listening yet.

## Manual steps

Run `pnpm db:migrate` once after a fresh clone; the dev servers don't migrate on boot.

## Local gotchas

- First build after a clean install takes ~4 min. It is not hung.
- UI is on :3999, not the Next.js default :3000.
- Auth0 dev tenant rate-limits past ~20 logins/hour.
```

### Sentinel

```markdown
# E2E run instructions

<!-- Managed by muggle-test-prepare. Hand-edits are preserved — re-run the skill to revise. -->

**Updated:** 2026-08-04T12:00:00Z

Nothing special — services start independently.
```

## Secrets

Never write a credential value. A password, token, API key, or connection string with embedded credentials belongs in a secret store or an env file — not in plaintext notes. Living outside the project keeps this file out of version control, but it is still readable on disk and is exactly the kind of file a user pastes into an issue when asking why their stack won't come up.

Record a **pointer** instead: the env-var name, or the name of the Muggle secret. `Set LOCAL_TEST_PASSWORD before running` is fine; the password is not.

If the user's free text contains something that looks like a credential, drop it, write the pointer form, and say so in one line.
