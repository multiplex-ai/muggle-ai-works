#!/usr/bin/env node
/**
 * Link this repo's maintainer-only skills (`.claude/skills/*`) into the user's
 * global `~/.claude/skills/` so `/mrelease` and `/muggle-works-npm-release`
 * resolve from any project — not only when the cwd is this repo.
 *
 * Idempotent and self-healing: re-run after a reorg to repoint links that rot
 * when a skill moves (the original breakage — the home link still pointed at the
 * deleted `plugin/skills/muggle-works-npm-release`).
 */

import {
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readlinkSync,
    rmdirSync,
    symlinkSync,
    unlinkSync,
} from "fs";
import { homedir, platform } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const isWindows = platform() === "win32";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceSkillsDir = join(repoRoot, ".claude", "skills");
const targetSkillsDir = join(homedir(), ".claude", "skills");

function normalizePath(path) {
    const resolved = resolve(path);
    return isWindows ? resolved.replace(/^\\\\\?\\/, "").toLowerCase() : resolved;
}

function lstatOrNull(path) {
    try {
        return lstatSync(path);
    } catch {
        return null;
    }
}

function linkTarget(path) {
    try {
        return normalizePath(resolve(dirname(path), readlinkSync(path)));
    } catch {
        return null;
    }
}

// Remove the link only — never recurse. On a directory symlink/junction a
// recursive delete would wipe the target's contents (the source skill itself):
// unlinkSync clears a POSIX symlink, rmdirSync clears a Windows reparse point.
function removeLink(path) {
    try {
        unlinkSync(path);
    } catch {
        rmdirSync(path);
    }
}

function linkSkill(name) {
    const source = join(sourceSkillsDir, name);
    const target = join(targetSkillsDir, name);
    const stat = lstatOrNull(target);

    if (stat && !stat.isSymbolicLink()) {
        return { name, action: "skipped (real directory, not a link)" };
    }
    if (stat && linkTarget(target) === normalizePath(source)) {
        return { name, action: "already linked" };
    }
    if (stat) {
        removeLink(target);
    }
    symlinkSync(source, target, isWindows ? "junction" : "dir");
    return { name, action: "linked" };
}

function maintainerSkillNames() {
    return readdirSync(sourceSkillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => existsSync(join(sourceSkillsDir, name, "SKILL.md")));
}

if (!existsSync(sourceSkillsDir)) {
    console.error(`No maintainer skills found at ${sourceSkillsDir}`);
    process.exit(1);
}

mkdirSync(targetSkillsDir, { recursive: true });

const names = maintainerSkillNames();
let failed = 0;
for (const name of names) {
    try {
        const { action } = linkSkill(name);
        console.log(`${action}: ${name}`);
    } catch (error) {
        failed += 1;
        console.error(`failed: ${name} — ${error.message}`);
    }
}
console.log(`\n${names.length - failed}/${names.length} maintainer skill(s) linked into ${targetSkillsDir}`);
process.exit(failed > 0 ? 1 : 0);
