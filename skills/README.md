# Muggle AI Skills

This directory is now a compatibility documentation location only.

Canonical plugin skill sources live in:

- `plugin/skills/muggle-do/`
- `plugin/skills/test-feature-local/`
- `plugin/skills/publish-test-to-cloud/`

## Installation model

Install Muggle skills through the plugin marketplace, not by manually copying skill files:

```bash
/plugin marketplace add <marketplace-url-or-path>
/plugin install muggle@<marketplace-name>
```

## Namespaced skill commands

After plugin installation:

- `/muggle:muggle-do`
- `/muggle:test-feature-local`
- `/muggle:publish-test-to-cloud`

## Contribution guidance

When updating skills:

1. Edit files under `plugin/skills/`.
2. Run `pnpm run build` (or `pnpm run build:plugin`) to regenerate `dist/plugin/`.
3. Validate plugin behavior via `claude --plugin-dir ./dist/plugin`.
