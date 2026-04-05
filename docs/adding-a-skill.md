# Adding a New Skill to Muggle AI Works

How to add a new plugin skill and update all the places that reference skills.

## 1. Create the skill

Create a directory and SKILL.md:

```
plugin/skills/<skill-name>/SKILL.md
```

The directory name should be prefixed with `muggle-` (e.g., `muggle-test`, `muggle-repair`). The `name` field in the SKILL.md frontmatter should **not** include the `muggle-` prefix — the plugin namespace `muggle:` provides it. This way the slash command becomes `/muggle:<name>`.

Example: directory `muggle-test` + `name: test` → `/muggle:test`

### SKILL.md format

```markdown
---
name: <skill-name-without-muggle-prefix>
description: "<one-paragraph description — this is the primary trigger mechanism>"
---

# Skill Title

Instructions for the AI agent...
```

The `description` field determines when Claude invokes the skill. Make it specific — include trigger phrases, contexts, and what the skill does.

## 2. Update the router

**File:** `plugin/skills/muggle/SKILL.md`

Add the new skill to both sections:

- **Menu** — add a line like `- /muggle:muggle-<skill-name> — short description`
- **Routing** — add an intent-matching rule like `intent keywords -> muggle-<skill-name>`

## 3. Update READMEs

### Plugin README

**File:** `plugin/README.md`

Add a row to the Skills table:

```markdown
| `/muggle:muggle-<skill-name>` | Description of what it does. |
```

### Root README

**File:** `README.md`

Add to the install list under "This installs:":

```markdown
- `/muggle:muggle-<skill-name>` — short description
```

## 4. Update documentation (muggle-ai-docs)

### Skills page (required)

**File:** `muggle-ai-docs/local-testing/skills.md`

- Add a row to the **Available Skills** table
- Add a **## /muggle:\<name\>** section with description, example, and any relevant comparisons

### Examples page (if applicable)

**File:** `muggle-ai-docs/local-testing/examples.md`

Add example prompts in the "Using Agent Skills" section at the bottom.

### Other pages (case by case)

These pages may need updates depending on the skill:

- `local-testing/overview.md` — if the skill changes the local testing workflow
- `getting-started/quickstart-by-role.md` — if relevant to a specific role's recommended path
- `getting-started/mcp-quickstart.md` — if the skill is a primary entry point

## 5. Sync dist

The build script (`scripts/build-plugin.mjs`) copies `plugin/` to `dist/plugin/` automatically. For local development, manually sync:

```bash
cp -r plugin/skills/<skill-name> dist/plugin/skills/<skill-name>
cp plugin/skills/muggle/SKILL.md dist/plugin/skills/muggle/SKILL.md
cp plugin/README.md dist/plugin/README.md
```

## 6. No registry needed

Skills are discovered automatically by directory — `scripts/postinstall.mjs` scans `plugin/skills/` and syncs them. No manifest or index file needs to list individual skills.

## Checklist

```
[ ] plugin/skills/<skill-name>/SKILL.md created (name without muggle- prefix)
[ ] plugin/skills/muggle/SKILL.md — menu + routing updated
[ ] plugin/README.md — skills table updated
[ ] README.md — install list updated
[ ] dist/plugin/ — synced (or will be on next build)
[ ] muggle-ai-docs/local-testing/skills.md — table + section added
[ ] muggle-ai-docs/local-testing/examples.md — examples added (if applicable)
```
