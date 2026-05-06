# Client Telemetry — Human Setup

This repo bundles the private `@multiplex-ai/telemetry` package source into its
shipped `dist/` so MCP and skill events can flow to Application Insights. The
private source is **not** referenced in `package.json` and is **never** committed
to this repo. It is fetched at build time only.

## What automation needs from a human

### 1. GitHub deploy key (required for CI to bundle real telemetry)

Without this, CI builds fall back to a stub and emit no telemetry — but they
still succeed. Set it up once:

1. Generate an Ed25519 SSH key pair on a trusted machine:

    ```sh
    ssh-keygen -t ed25519 -f telemetry-deploy-key -C "muggle-ai-works CI" -N ""
    ```

2. In `multiplex-ai/muggle-ai-telemetry` → Settings → Deploy keys → Add deploy
   key. Paste the contents of `telemetry-deploy-key.pub`. Title:
   `muggle-ai-works CI`. Leave **Allow write access** unchecked.

3. In `multiplex-ai/muggle-ai-works` → Settings → Secrets and variables →
   Actions → New repository secret. Name: `TELEMETRY_REPO_KEY`. Value:
   contents of the **private** key file `telemetry-deploy-key`.

4. Delete both local key files.

The CI workflows reference this secret in conditional steps:
- `.github/workflows/ci.yml`
- `.github/workflows/publish-works-to-npm.yml`

If the secret is missing, the steps are skipped and `scripts/fetch-telemetry.mjs`
writes a no-op stub so build/test/typecheck still pass.

### 2. App Insights connection string (required to emit telemetry at runtime)

Telemetry events are emitted by end users running the published `@muggleai/works`
CLI on their own machines. The App Insights connection string is read from the
`APPLICATIONINSIGHTS_CONNECTION_STRING` env var at runtime. If missing,
`initTelemetry()` becomes a no-op.

- For local dev: export the env var in your shell.
- For shipped builds: not embedded in the bundle today. Decide later whether to
  inline a default (per environment) at CI build time the same way the Electron
  app does.

## Local developer flow

To iterate on the telemetry package without committing or pushing:

```sh
# Point at your local clone of muggle-ai-telemetry; build picks it up.
export MUGGLE_TELEMETRY_DEV_PATH=/path/to/muggle-ai-telemetry
pnpm run build
```

Without `MUGGLE_TELEMETRY_DEV_PATH`, the script tries to `git clone` the private
repo (requires SSH access) and falls back to a stub on failure.

## Pinning to a specific telemetry version

To pin the bundled telemetry to a specific tag/SHA, set `MUGGLE_TELEMETRY_REF`
in CI (defaults to `main`):

```sh
MUGGLE_TELEMETRY_REF=v0.1.0 pnpm run build
```

## Verification

After every build, `scripts/verify-telemetry-bundle.mjs` runs and asserts that
the string `@multiplex-ai/telemetry` does not appear in `package.json` or
anywhere under `dist/`. The script exits non-zero on any leak.

## Files involved

- `scripts/fetch-telemetry.mjs` — fetches private source at build time
- `scripts/verify-telemetry-bundle.mjs` — guards against name leaks
- `packages/mcps/src/_telemetry/` — re-export indirection (committed) +
  `_vendor/` (gitignored, populated by fetch script)
- `.gitignore` — excludes `packages/mcps/src/_telemetry/_vendor/`
- `.github/workflows/{ci,publish-works-to-npm}.yml` — deploy-key setup steps
