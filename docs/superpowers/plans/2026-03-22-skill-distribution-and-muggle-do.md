# Skill Distribution & Muggle-Do State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribute Claude Code skills to customers via `npm install -g @muggleai/works` and replace the stateless muggle-do pipeline with a session-based, iterative state machine.

**Architecture:** Skills are markdown files bundled in `skills-dist/` and copied to `~/.claude/skills/muggle/` during postinstall. The muggle-do skill manages state via `.muggle-do/sessions/<slug>/` directories with markdown files for each session's state, requirements, iterations, and results.

**Tech Stack:** Node.js (postinstall script), markdown (skills + state files), SHA-256 checksums (update detection), readline (TTY prompting)

**Spec:** `docs/superpowers/specs/2026-03-22-skill-distribution-and-muggle-do-state-machine-design.md`

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `skills-dist/muggle-do.md` | Consolidated orchestrator skill with embedded state machine, session management, all stage instructions, triage logic, and guardrails |
| `skills-dist/test-feature-local.md` | Adapted from `skills/local/test-feature-local/SKILL.md` — add Claude Code skill frontmatter |
| `skills-dist/publish-test-to-cloud.md` | Adapted from `skills/local/publish-test-to-cloud/SKILL.md` — add Claude Code skill frontmatter |

### Files to modify

| File | Change |
|------|--------|
| `scripts/postinstall.mjs` | Add `installSkills()` function: copy skills to `~/.claude/skills/muggle/`, checksum tracking, TTY prompting for modified files |
| `package.json` | Add `"skills-dist"` to `files` array |

---

## Task 1: Create `skills-dist/test-feature-local.md`

**Files:**
- Create: `skills-dist/test-feature-local.md`
- Reference: `skills/local/test-feature-local/SKILL.md`

This is a direct adaptation — the content is identical, just needs Claude Code skill frontmatter format verified.

- [ ] **Step 1: Create the skill file**

Copy content from `skills/local/test-feature-local/SKILL.md` to `skills-dist/test-feature-local.md`. The file already has correct frontmatter (`name`, `description`). No content changes needed — the MCP tool names and workflow are already correct for distribution.

- [ ] **Step 2: Verify frontmatter**

Ensure the file starts with:
```yaml
---
name: test-feature-local
description: Test a feature's user experience on localhost. Sync entities in cloud (muggle-remote-* tools), then execute locally (muggle-local-* tools) against localhost. Requires explicit approval before launching electron-app.
---
```

- [ ] **Step 3: Commit**

```bash
git add skills-dist/test-feature-local.md
git commit -m "feat: add distributable test-feature-local skill"
```

---

## Task 2: Create `skills-dist/publish-test-to-cloud.md`

**Files:**
- Create: `skills-dist/publish-test-to-cloud.md`
- Reference: `skills/local/publish-test-to-cloud/SKILL.md`

Same as Task 1 — direct copy with frontmatter verification.

- [ ] **Step 1: Create the skill file**

Copy content from `skills/local/publish-test-to-cloud/SKILL.md` to `skills-dist/publish-test-to-cloud.md`. Already has correct frontmatter.

- [ ] **Step 2: Commit**

```bash
git add skills-dist/publish-test-to-cloud.md
git commit -m "feat: add distributable publish-test-to-cloud skill"
```

---

## Task 3: Create `skills-dist/muggle-do.md`

**Files:**
- Create: `skills-dist/muggle-do.md`
- Reference: `.claude/commands/muggle-do.md` (current orchestrator)
- Reference: `.claude/skills/muggle-do/*.md` (6 stage files)
- Reference: `docs/superpowers/specs/2026-03-22-skill-distribution-and-muggle-do-state-machine-design.md`

This is the largest task — a new consolidated skill file that replaces the current 7-file muggle-do implementation with a session-based state machine.

- [ ] **Step 1: Create the skill file with frontmatter and overview**

```markdown
---
name: muggle-do
description: Autonomous development pipeline. Takes a task through requirements, coding, testing, QA, and PR creation with iterative fix loops. Manages state in .muggle-do/sessions/ for auditability and crash recovery.
---
```

The file must include these sections (see spec for full details):

1. **Overview** — what muggle-do does, the pipeline stages
2. **Input** — `$ARGUMENTS` (the user's task description)
3. **Session Management** — startup flow: list existing sessions, resume or create new
4. **Session naming** — slug from task description, max 50 chars, collision handling
5. **State file locations** — `.muggle-do/sessions/<slug>/state.md`, `requirements.md`, `iterations/NNN.md`, `result.md`
6. **State machine** — stages, transitions, the full flow diagram from the spec
7. **Stage instructions** — embedded from the 6 current stage files, plus the new CODING and TRIAGE stages:
   - REQUIREMENTS (from `requirements.md`)
   - IMPACT_ANALYSIS (from `impact-analysis.md`)
   - VALIDATE_CODE (from `validate-code.md`)
   - CODING (new — spec section "CODING Stage Specification")
   - UNIT_TESTS (from `unit-tests.md`)
   - QA (from `qa.md`)
   - TRIAGE (new — spec sections "Triage Behavior" + "Triage Decision Heuristics")
   - OPEN_PRS (from `open-prs.md`)
8. **State write protocol** — when and how to update state.md and iteration files
9. **Guardrails** — max fix attempts per stage (3), max iterations (3), escalation rules
10. **Iteration tracking** — how iterations are numbered, what triggers a new iteration
11. **Repo configuration** — `muggle-repos.json` format and discovery
12. **Error handling** — what to do when stages fail, when to escalate to user

Key differences from current implementation:
- Sessions replace single-run state
- CODING stage added (Claude writes/fixes code)
- TRIAGE stage added (analyzes failures, decides where to jump back)
- Iterative loops instead of fail-fast
- State persisted to markdown files after each stage
- Resume from crash supported via state.md check on startup
- All stage instructions embedded (no separate files to reference)

- [ ] **Step 2: Verify the skill file is self-contained**

The skill must NOT reference any external files (no `.claude/skills/muggle-do/requirements.md` paths). All stage instructions must be embedded inline. The only external references should be:
- MCP tool names (e.g., `muggle-remote-auth-status`)
- `muggle-repos.json` (user's project config)
- `.muggle-do/sessions/` (state directory)

- [ ] **Step 3: Commit**

```bash
git add skills-dist/muggle-do.md
git commit -m "feat: add distributable muggle-do skill with state machine and sessions"
```

---

## Task 4: Add postinstall skill installation

**Files:**
- Modify: `scripts/postinstall.mjs` (add ~150 lines)
- Reference: existing patterns in `postinstall.mjs` for logging, error handling, file operations

The postinstall already has patterns for: logging (`log()`, `logError()`), file operations (`existsSync`, `mkdirSync`, `readFileSync`, `writeFileSync`), checksum calculation (`calculateFileChecksum`), and `createRequire` for reading `package.json`. Follow these patterns.

- [ ] **Step 1: Add constants**

Add near the top of `postinstall.mjs`, after the existing constants (line ~30):

```javascript
const SKILLS_DIR_NAME = "skills-dist";
const SKILLS_TARGET_DIR = join(homedir(), ".claude", "skills", "muggle");
const SKILLS_CHECKSUMS_FILE = "skills-checksums.json";
```

- [ ] **Step 2: Add `calculateFileSha256` helper**

The file already has `calculateFileChecksum` (line 242) that returns SHA-256 hex. Reuse it for skill checksums.

- [ ] **Step 3: Add `readSkillsChecksums` function**

```javascript
/**
 * Read the skills checksums file.
 * @returns {Record<string, unknown> | null} Parsed checksums, or null if missing/invalid
 */
function readSkillsChecksums() {
    const checksumPath = join(homedir(), ".muggle-ai", SKILLS_CHECKSUMS_FILE);
    if (!existsSync(checksumPath)) {
        return null;
    }
    try {
        const content = readFileSync(checksumPath, "utf-8");
        const parsed = JSON.parse(content);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}
```

- [ ] **Step 4: Add `writeSkillsChecksums` function**

```javascript
/**
 * Write the skills checksums file.
 * @param {Record<string, string>} fileChecksums - Map of filename to SHA-256 hex
 */
function writeSkillsChecksums(fileChecksums) {
    const packageJson = require("../package.json");
    const checksumPath = join(homedir(), ".muggle-ai", SKILLS_CHECKSUMS_FILE);
    const data = {
        schemaVersion: 1,
        packageVersion: packageJson.version,
        files: fileChecksums,
    };
    mkdirSync(join(homedir(), ".muggle-ai"), { recursive: true });
    writeFileSync(checksumPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}
```

- [ ] **Step 5: Add `promptUserChoice` function**

```javascript
/**
 * Prompt user for A/B choice with timeout.
 * @param {string} filename - The skill file being updated
 * @returns {Promise<"A"|"B">} User's choice, defaults to B on timeout/no-TTY
 */
async function promptUserChoice(filename) {
    if (!process.stdin.isTTY) {
        return "B";
    }

    const { createInterface } = await import("readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            rl.close();
            log(`Timeout waiting for input on ${filename}, defaulting to backup + overwrite`);
            resolve("B");
        }, 30000);

        rl.question(
            `\nSkill file "${filename}" has been modified.\n` +
            `  (A) Overwrite with new version\n` +
            `  (B) Backup current version, then overwrite\n` +
            `Choice [B]: `,
            (answer) => {
                clearTimeout(timeout);
                rl.close();
                const choice = (answer || "").trim().toUpperCase();
                resolve(choice === "A" ? "A" : "B");
            }
        );
    });
}
```

- [ ] **Step 6: Add `backupSkillFile` function**

```javascript
/**
 * Backup a skill file to ~/.muggle-ai/skills-backup/{timestamp}/
 * @param {string} filename - Skill filename
 * @param {string} sourcePath - Current file path to backup
 */
function backupSkillFile(filename, sourcePath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = join(homedir(), ".muggle-ai", "skills-backup", timestamp);
    mkdirSync(backupDir, { recursive: true });
    const backupPath = join(backupDir, filename);
    const content = readFileSync(sourcePath, "utf-8");
    writeFileSync(backupPath, content, "utf-8");
    log(`Backed up ${filename} to ${backupPath}`);
}
```

- [ ] **Step 7: Add `installSkills` function**

This is the main function. It:
1. Reads `skills-dist/` from the package directory
2. For each skill file, checks target, compares checksums, prompts if modified
3. Copies files and updates checksums

```javascript
/**
 * Install skill files to ~/.claude/skills/muggle/
 */
async function installSkills() {
    try {
        const packageDir = join(process.cwd());
        const skillsSourceDir = join(packageDir, SKILLS_DIR_NAME);

        if (!existsSync(skillsSourceDir)) {
            log("No skills-dist directory found, skipping skill installation.");
            return;
        }

        const skillFiles = readdirSync(skillsSourceDir).filter(f => f.endsWith(".md"));
        if (skillFiles.length === 0) {
            log("No skill files found in skills-dist/, skipping.");
            return;
        }

        mkdirSync(SKILLS_TARGET_DIR, { recursive: true });

        const existingChecksums = readSkillsChecksums();
        const storedFiles = (existingChecksums && existingChecksums.files) || {};
        const newChecksums = {};

        for (const filename of skillFiles) {
            const sourcePath = join(skillsSourceDir, filename);
            const targetPath = join(SKILLS_TARGET_DIR, filename);
            const sourceChecksum = await calculateFileChecksum(sourcePath);

            if (!existsSync(targetPath)) {
                // File doesn't exist — copy it
                const content = readFileSync(sourcePath, "utf-8");
                writeFileSync(targetPath, content, "utf-8");
                log(`Installed skill: ${filename}`);
            } else {
                const targetChecksum = await calculateFileChecksum(targetPath);
                const storedChecksum = storedFiles[filename] || "";

                if (targetChecksum === storedChecksum || storedChecksum === "") {
                    // Not modified by user — overwrite silently
                    const content = readFileSync(sourcePath, "utf-8");
                    writeFileSync(targetPath, content, "utf-8");
                    log(`Updated skill: ${filename}`);
                } else {
                    // User modified the file — prompt
                    const choice = await promptUserChoice(filename);
                    if (choice === "B") {
                        backupSkillFile(filename, targetPath);
                    }
                    const content = readFileSync(sourcePath, "utf-8");
                    writeFileSync(targetPath, content, "utf-8");
                    log(`${choice === "B" ? "Backed up and overwrote" : "Overwrote"} skill: ${filename}`);
                }
            }

            newChecksums[filename] = sourceChecksum;
        }

        writeSkillsChecksums(newChecksums);
        log(`Installed ${skillFiles.length} skill(s) to ${SKILLS_TARGET_DIR}`);
    } catch (error) {
        logError("\n========================================");
        logError("ERROR: Failed to install skills");
        logError("========================================\n");
        logError("Error:", error instanceof Error ? error.stack || error.message : error);
        logError("\nSkill installation is optional. MCP tools still work without skills.");
        logError("");
    }
}
```

- [ ] **Step 8: Wire into postinstall main**

At the bottom of `postinstall.mjs`, add `installSkills()` to the execution chain. Current code (line 678-682):

```javascript
// Run postinstall
initLogFile();
removeVersionOverrideFile();
updateCursorMcpConfig();
downloadElectronApp().catch(logError);
```

Change to:

```javascript
// Run postinstall
initLogFile();
removeVersionOverrideFile();
updateCursorMcpConfig();
installSkills().catch(logError);
downloadElectronApp().catch(logError);
```

Note: `installSkills()` before `downloadElectronApp()` since skills are fast (file copy) and the Electron download is slow (network).

- [ ] **Step 9: Commit**

```bash
git add scripts/postinstall.mjs
git commit -m "feat: install Claude Code skills during postinstall"
```

---

## Task 5: Update `package.json` files field

**Files:**
- Modify: `package.json:10-14`

- [ ] **Step 1: Add skills-dist to files array**

Current:
```json
"files": [
    "dist",
    "bin/muggle.js",
    "scripts/postinstall.mjs"
],
```

Change to:
```json
"files": [
    "dist",
    "bin/muggle.js",
    "scripts/postinstall.mjs",
    "skills-dist"
],
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "feat: include skills-dist in npm package"
```

---

## Task 6: Verify end-to-end

- [ ] **Step 1: Run npm pack to verify skills are included**

```bash
npm pack --dry-run 2>&1
```

Expected: output includes `skills-dist/muggle-do.md`, `skills-dist/test-feature-local.md`, `skills-dist/publish-test-to-cloud.md`

- [ ] **Step 2: Test postinstall skill installation**

```bash
node scripts/postinstall.mjs
```

Expected: skills copied to `~/.claude/skills/muggle/`, checksums written to `~/.muggle-ai/skills-checksums.json`

- [ ] **Step 3: Verify checksum-based update detection**

1. Modify `~/.claude/skills/muggle/test-feature-local.md` (add a comment)
2. Re-run `node scripts/postinstall.mjs`
3. Expected: prompted with A/B choice for the modified file

- [ ] **Step 4: Verify skills are discoverable in Claude Code**

```bash
ls ~/.claude/skills/muggle/
```

Expected: `muggle-do.md`, `test-feature-local.md`, `publish-test-to-cloud.md`

- [ ] **Step 5: Commit verification results or fixes**

---

## Parallel Execution Guide

Tasks 1-3 (skill files) and Task 4 (postinstall) are **fully independent** and can be executed in parallel by separate agents:

| Agent | Tasks | Dependencies |
|-------|-------|-------------|
| Agent A | Task 1 + Task 2 (simple skill copies) | None |
| Agent B | Task 3 (muggle-do.md — largest task) | None |
| Agent C | Task 4 (postinstall.mjs changes) | None |
| Sequential | Task 5 (package.json) | After Tasks 1-4 |
| Sequential | Task 6 (verification) | After Task 5 |
