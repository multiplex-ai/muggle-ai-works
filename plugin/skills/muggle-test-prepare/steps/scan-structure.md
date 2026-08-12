# Stage 1 — Scan the structure

Derive the service graph from what the workspace declares, so the interview only covers what a scan cannot know. Reading manifests beats interrogating the user about their own repo layout.

Runs only on a [learning run](./replay-or-learn.md). A replay never scans.

## Ask before reading anything

Nothing is read until the user says where. `AskUserQuestion`:

> "To work out your services, I can scan the code — or you can just tell me. Which?"

- `Scan <cwd>` — `Read manifests here, 2 levels deep, to find services and their start commands.`
- `Scan a different folder` — `Name the folder and how deep to look.`
- `I'll list them` — `Give me the service paths yourself; I won't read anything you haven't named.`

The default depth is **2 levels**, which reaches `packages/*` and `services/*` without walking a whole disk. The user may set it higher or lower when naming the folder.

`I'll list them` skips the scan entirely: take the paths and service names from the user and continue to the interview with those as the graph. Read only the top-level indicator files of the paths they named, and only to determine the start command.

Record the granted scope — folder and depth — with the recipe, so a later run reuses the same permission rather than asking again. Widening it needs a fresh ask.

## Read, in this order

Within the granted scope only:

1. **Workspace manifests** — `pnpm-workspace.yaml`, the `workspaces` field of a root `package.json`, `turbo.json`, `lerna.json`, `nx.json`, `Cargo.toml` `[workspace]`, `go.work`. These name the members directly, so a monorepo needs no guessing.
2. **Compose and process files** — `docker-compose.yml`, `Procfile`, `Makefile`, `Tiltfile`, `skaffold.yaml`. These carry service names, ports, and often the dependency order outright (`depends_on`).
3. **Per-service manifests** for each member found — `package.json` scripts (`dev`, `start`, `serve`), `Cargo.toml`, `go.mod`, `pyproject.toml`. This is where the start command comes from.
4. **Port declarations** — `.env.example`, `vite.config.*`, `next.config.*`, a `PORT` in the start script. Never a framework default: an undeclared port is unknown, not `:3000`.

## Emit

A proposed service graph — for each: name, directory, start command with its source, expected port with its source, and whether the scan believes it is required for the declared scope.

Plus what the scan **could not** determine. That list is the interview's agenda; everything else is already settled.

Show the user what was found before asking anything else. A scan they can see is a scan they can correct.

## What a scan cannot know

State these as unknowns rather than guessing, because each is a judgement about intent rather than a fact in a file:

- Which services this user actually needs running for the tests they care about.
- Which cannot run locally at all (a payment gateway needing production certificates).
- Startup ordering that no `depends_on` declares but which the app requires anyway.
- Anything that has to happen by hand before a service is usable.

## Boundaries

Read only inside the folder the user granted, to the depth they set. A directory outside that scope may have its name listed to offer it as a candidate; its contents stay unread until the user names it.
