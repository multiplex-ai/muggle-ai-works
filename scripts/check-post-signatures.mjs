#!/usr/bin/env node

// Enforces the signing rule documented in plugin/skills/_shared/vcs/post-signature.md:
// a recipe that posts a body to a PR/MR must sign that body by piping it through
// scripts/sign-body.sh. Only shell blocks count — prose naming a command ("never
// call gh pr comment here") is a mention, not a call site.
//
// The failure this catches is silent: a posting recipe that never signs still
// posts successfully, and the unsigned comment is indistinguishable from a human
// one from then on, which breaks echo-protection and loop classification.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN_DIR = "plugin";
const SIGNER = "sign-body.sh";

// Each pattern matches a shell invocation that writes a body to a PR/MR.
// Reads through the same CLIs (gh api --jq, gh pr view) never match.
const POSTING_PATTERNS = [
  { name: "gh pr comment", re: /\bgh\s+pr\s+comment\b/ },
  { name: "gh pr create", re: /\bgh\s+pr\s+create\b/ },
  { name: "gh pr edit --body", re: /\bgh\s+pr\s+edit\b[^\n]*--body/ },
  { name: "gh api write to a comment", re: /\bgh\s+api\b[^\n]*--method\s+(POST|PATCH)/ },
  { name: "glab mr note", re: /\bglab\s+mr\s+note\b/ },
  { name: "glab mr create", re: /\bglab\s+mr\s+create\b/ },
  { name: "glab mr update --description", re: /\bglab\s+mr\s+update\b[^\n]*--description/ },
  { name: "glab api write to a note", re: /\bglab\s+api\b[^\n]*--method\s+(POST|PATCH)/ },
];

const SHELL_FENCE_RE = /^\s*```(bash|sh|shell)\s*$/;
const FENCE_END_RE = /^\s*```\s*$/;

/**
 * Collects the shell-fenced commands of a markdown document, one entry per logical
 * command: backslash-continued lines are joined so a flag never hides from a pattern
 * by sitting on the next physical line. The reported line is where the command opens.
 *
 * Output shape: `[{ line: 7, text: "gh api --method POST /repos/... -f body=..." }]`
 *
 * @param {string} content Markdown source.
 * @returns {{ line: number, text: string }[]} One entry per command inside a shell fence.
 */
export function shellLines(content) {
  const out = [];
  let inShellFence = false;
  let pending = null;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inShellFence && SHELL_FENCE_RE.test(line)) {
      inShellFence = true;
      pending = null;
      continue;
    }
    if (inShellFence && FENCE_END_RE.test(line)) {
      if (pending) out.push(pending);
      inShellFence = false;
      pending = null;
      continue;
    }
    if (!inShellFence) continue;
    const isContinued = /\\\s*$/.test(line);
    const text = line.replace(/\\\s*$/, "");
    if (pending) pending.text += " " + text.trim();
    else pending = { line: i + 1, text: text };
    if (!isContinued) {
      out.push(pending);
      pending = null;
    }
  }
  if (pending) out.push(pending);
  return out;
}

/**
 * Reports the posting call sites in one file that are not accompanied by a signing step.
 *
 * Signing is checked per file rather than per command: a recipe that pipes one body
 * through the signer establishes the pattern for the block it documents.
 *
 * Output shape: `[{ file: "plugin/...", line: 7, command: "gh pr comment" }]`
 *
 * @param {string} relPath Repo-relative path, used in the report.
 * @param {string} content Markdown source.
 * @returns {{ file: string, line: number, command: string }[]} Unsigned posting call sites.
 */
export function findUnsignedPosts(relPath, content) {
  const shell = shellLines(content);
  if (shell.length === 0) return [];
  const signsSomewhere = content.includes(SIGNER);
  if (signsSomewhere) return [];
  const violations = [];
  for (const { line, text } of shell) {
    for (const pattern of POSTING_PATTERNS) {
      if (pattern.re.test(text)) {
        violations.push({ file: relPath, line: line, command: pattern.name });
        break;
      }
    }
  }
  return violations;
}

function listMarkdown(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listMarkdown(full, acc);
    else if (entry.isFile() && entry.name.endsWith(".md")) acc.push(full);
  }
  return acc;
}

function findPluginDir(start) {
  let dir = start;
  for (let i = 0; i < 50; i++) {
    const candidate = path.join(dir, PLUGIN_DIR);
    if (fs.existsSync(path.join(candidate, "skills"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function runLint() {
  const pluginDir = findPluginDir(process.cwd());
  if (!pluginDir) {
    console.error("check-post-signatures: could not locate plugin/ from", process.cwd());
    process.exit(2);
  }
  const repoRoot = path.dirname(pluginDir);
  const signerPath = path.join(pluginDir, "scripts", SIGNER);
  if (!fs.existsSync(signerPath)) {
    console.error(`check-post-signatures: the signer is missing at ${path.relative(repoRoot, signerPath)}`);
    process.exit(1);
  }

  const violations = [];
  let posting = 0;
  for (const abs of listMarkdown(pluginDir)) {
    const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
    const content = fs.readFileSync(abs, "utf8");
    const found = findUnsignedPosts(rel, content);
    if (content.includes(SIGNER)) posting++;
    violations.push(...found);
  }

  if (violations.length === 0) {
    console.log(`check-post-signatures: OK — ${posting} signing recipes, no unsigned posts.`);
    return;
  }
  console.error("check-post-signatures: bodies posted without a signature:\n");
  for (const v of violations) {
    console.error(`  - ${v.file}:${v.line} — '${v.command}' posts a body this file never signs.`);
  }
  console.error(
    `\nPipe the body through plugin/scripts/${SIGNER} (see plugin/skills/_shared/vcs/post-signature.md).` +
      "\nAn unsigned post is indistinguishable from a human comment, which breaks echo-protection."
  );
  process.exit(1);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url || invokedPath === pathToFileURL(fileURLToPath(import.meta.url)).href) {
  runLint();
}
