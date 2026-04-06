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

- `pnpm run verify:plugin` checks manifest and marketplace alignment.
- `pnpm run verify:contracts` checks CLI/MCP/plugin/skill contracts.
- `pnpm run verify:electron-release-checksums` checks that the bundled electron release publishes `checksums.txt` with valid SHA256 entries for all platform artifacts.
- `pnpm run verify:upgrade-experience` validates in-place existing-user upgrade behavior:
  - setup download,
  - cleanup of stale versions,
  - force upgrade redownload,
  - post-upgrade doctor/status health.

## Change Risk Tiers

Use this model to decide which checks are mandatory.

1. **Low risk (internal-only)**  
   Required: lint, tests, build, `verify:plugin`, `verify:contracts`.

2. **Medium risk (runtime behavior)**  
   Required: low-risk checks plus upgrade experience validation.

3. **High risk (public contract changes)**  
   Required: medium-risk checks plus targeted manual client smoke checks on Claude and Cursor.

## Automation

- `ci.yml` runs build-time verification on every push/PR to `master`.
- `upgrade-experience.yml` runs weekly and on manual dispatch to validate existing-user upgrade behavior over time.

## Operational Rules

- If a public identifier changes, update `contracts.json` in the same PR.
- Any intentionally removed identifier should include migration guidance.
- A release should not proceed if medium/high-risk checks fail.
