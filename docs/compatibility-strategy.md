# Compatibility Strategy

This document defines the long-term verification strategy used by `muggle-ai-works` to keep user-facing behavior stable across rebrands and other high-impact changes.

## Objectives

- Keep critical public surfaces stable by default.
- Detect contract drift in CI before release.
- Validate both fresh install and existing-user upgrade paths.

## Contract Baselines

The baseline contract file is:

- `config/compatibility/contracts.json`

It captures required values for:

- CLI identity and required commands
- MCP server naming and package identifier
- plugin name and session-start hook behavior
- required skill directories
- legacy identifier policy (`supported`, `aliased`, `removed-with-guidance`)

## Verification Commands

- `pnpm run verify:plugin` checks manifest and marketplace alignment for Claude Code, Cursor, and Codex, the Codex MCP server's timeout and host stamp, and that `plugin/hooks/codex-hooks.json` matches what `hooks.json` generates.
- `pnpm run verify:contracts` checks CLI/MCP/plugin/skill contracts.
- `pnpm run verify:electron-release-checksums` checks that the bundled electron release publishes `checksums.txt` with valid SHA256 entries for all platform artifacts.
- `pnpm run verify:upgrade-experience` validates in-place existing-user upgrade behavior:
  - setup download,
  - cleanup of stale versions,
  - force upgrade redownload,
  - post-upgrade doctor/status health.

## Codex

Codex loads the same plugin through its own manifest, hooks file, and MCP config, and it fails quietly in ways Claude Code does not. A hook whose matcher names no tool never fires. A malformed hook output is ignored. A skill past the catalog budget is dropped. So each surface is pinned at three levels.

1. **Static contracts** (`pnpm test`, every PR):
   - `src/test/skills/codex-skill-compat.test.ts`: the skill frontmatter Codex parses, alias `agents/openai.yaml`, and the catalog budget.
   - `src/test/codex/codex-plugin-contract.test.ts`: manifest, marketplace, MCP config, and hook outputs Codex accepts.
   - `src/test/codex/codex-mcp-environment.test.ts`: every variable the MCP server reads reaches it under Codex.
   - `src/test/codex/codex-mcp-tool-names.test.ts`: the hooks select the same tools under Codex's tool names.
   - `src/test/codex/codex-hook-windows.test.ts`: the Windows hook launcher.
   - `packages/mcps/src/test/codex-tool-limits.test.ts`: tool names and schemas within Codex's limits.
2. **The real Codex CLI** (`pnpm run test:codex` with `CODEX_BIN` set; CI's `codex-compat` job on Linux, Windows and macOS, at the `CODEX_CLI_VERSION` it pins):
   - The plugin is installed with Codex's own commands and run against a scripted model. That covers the skills catalog, `$muggle:` mentions, every MCP tool, the hooks and guardrails, and the eval harnesses' Codex plumbing.
   - No credentials are needed.
3. **Model-driven evals** (`.github/workflows/codex-skill-eval.yml`, nightly and on the PRs that can move them; needs the `OPENAI_API_KEY` secret; not required):
   - The routing, skill-gate and agent-gate evals run with `--host codex`. See each eval's README under `internal/`.
   - Routing is gated against `internal/skill-routing-eval/recall-baseline.codex.json` once one is promoted.

To move to a new Codex release, change `CODEX_CLI_VERSION` in `ci.yml` and `codex-skill-eval.yml` together. The `codex-compat` job is what proves the new version.

## Change Risk Tiers

Use this model to decide which checks are mandatory.

1. **Low risk (internal-only)**  
   Required: lint, tests, build, `verify:plugin`, `verify:contracts`.

2. **Medium risk (runtime behavior)**  
   Required: low-risk checks plus upgrade experience validation.

3. **High risk (public contract changes)**  
   Required: medium-risk checks plus targeted manual client smoke checks on Claude, Cursor, and Codex (`codex plugin add muggle@muggle-works` from a local marketplace, then `codex mcp list` and `/skills`).

## Automation

- `ci.yml` runs build-time verification on every push/PR to `master`, including the `codex-compat` live suite.
- `codex-skill-eval.yml` runs the model-driven evals under Codex nightly, and on PRs that touch what they measure.
- `verify-end-user-upgrade.yml` runs weekly and on manual dispatch to validate existing-user upgrade behavior over time.

## Operational Rules

- If a public identifier changes, update `contracts.json` in the same PR.
- Any intentionally removed identifier should include migration guidance.
- A release should not proceed if medium/high-risk checks fail.
