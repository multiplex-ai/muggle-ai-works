#!/usr/bin/env node

// Enforces the one-way dependency rule documented in plugin/skills/CLAUDE.md:
// a reference is a cross-skill markdown file-link, and if skill A links to B
// then no file in B may link back to A. A reverse reference shows up as a cycle
// in the derived link graph. Runtime slash-command dispatch is prose, not a
// link, so it is ignored; a shared namespace is exploded to per-file nodes so
// unrelated modules under it never manufacture a false cycle.
//
// Modes:
//   (default)  full-tree lint for CI — scans plugin/skills, exits 1 on violations.
//   --hook     PreToolUse gate — reads hook JSON on stdin, denies only when the
//              edited file itself introduces a new upward/cyclic link.

import fs from "node:fs";
import path from "node:path";

const SKILLS_DIR = path.join("plugin", "skills");

function findSkillsRoot(start) {
  let dir = fs.existsSync(start) && fs.statSync(start).isDirectory() ? start : path.dirname(start);
  for (let i = 0; i < 50; i++) {
    if (path.basename(dir) === "skills" && path.basename(path.dirname(dir)) === "plugin") return dir;
    const candidate = path.join(dir, SKILLS_DIR);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadConfig(skillsRoot) {
  const file = path.join(skillsRoot, "skill-deps.config.json");
  const base = { supportDirs: {}, sharedNamespaces: [], knownReverseDeps: { edges: [] } };
  if (!fs.existsSync(file)) return base;
  try {
    return { ...base, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return base;
  }
}

function segments(relPath) {
  return relPath.split(/[\\/]/).filter(Boolean);
}

function skillOf(relFromRoot, config) {
  const segs = segments(relFromRoot);
  if (segs.length < 2) return null; // file sits directly in skills root (repo docs, config)
  const top = segs[0];
  if (top === ".." || top === ".") return null; // escaped the skills tree
  // A shared namespace is not a skill but a bag of independent modules; each file
  // is its own node so unrelated modules don't manufacture a false cycle.
  if (config.sharedNamespaces.includes(top)) return segs.join("/");
  return config.supportDirs[top] || top;
}

function listMarkdown(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listMarkdown(full, acc);
    else if (entry.isFile() && entry.name.endsWith(".md")) acc.push(full);
  }
  return acc;
}

const LINK_RE = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const REFDEF_RE = /^\s*\[[^\]]+\]:\s*(\S+)/;

function extractTargets(line) {
  const out = [];
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(line)) !== null) out.push(m[1]);
  const ref = REFDEF_RE.exec(line);
  if (ref) out.push(ref[1]);
  return out;
}

function isExternalTarget(raw) {
  return /^(https?:|mailto:|tel:|#|\/\/)/.test(raw);
}

// Cross-skill edges out of one file's content.
function edgesFromFile(absFile, content, skillsRoot, config) {
  const relFile = path.relative(skillsRoot, absFile);
  const sourceSkill = skillOf(relFile, config);
  if (!sourceSkill) return [];
  const edges = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const rawFull of extractTargets(lines[i])) {
      const raw = rawFull.split("#")[0];
      if (!raw || isExternalTarget(rawFull)) continue;
      const targetAbs = path.resolve(path.dirname(absFile), raw);
      const targetRel = path.relative(skillsRoot, targetAbs);
      if (targetRel.startsWith("..")) continue; // outside the skills tree (agents, commands)
      const targetSkill = skillOf(targetRel, config);
      if (!targetSkill || targetSkill === sourceSkill) continue;
      const sourceFile = relFile.split(/[\\/]/).join("/");
      edges.push({ source: sourceSkill, target: targetSkill, sourceFile, line: i + 1, raw: rawFull });
    }
  }
  return edges;
}

function buildEdges(skillsRoot, config, overrides = new Map()) {
  const files = new Set(listMarkdown(skillsRoot).map((f) => path.resolve(f)));
  for (const f of overrides.keys()) files.add(path.resolve(f));
  const edges = [];
  for (const abs of files) {
    let content;
    if (overrides.has(abs)) content = overrides.get(abs);
    else {
      try {
        content = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
    }
    if (content == null) continue;
    edges.push(...edgesFromFile(abs, content, skillsRoot, config));
  }
  return edges;
}

// Tarjan SCCs; returns skill -> scc id, plus the set of skills in a cycle
// (scc size > 1). Self-loops are impossible here (source !== target).
function cyclicSkills(edges) {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    adj.get(e.source).add(e.target);
    if (!adj.has(e.target)) adj.set(e.target, new Set());
  }
  let idx = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const inCycle = new Set();

  const strongconnect = (v) => {
    index.set(v, idx);
    low.set(v, idx);
    idx++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) || []) {
      if (!index.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) for (const s of comp) inCycle.add(s);
    }
  };

  for (const v of adj.keys()) if (!index.has(v)) strongconnect(v);
  return inCycle;
}

function ignoreMatcher(config) {
  const edges = (config.knownReverseDeps && config.knownReverseDeps.edges) || [];
  const keys = new Set(edges.map((g) => `${g.from}|${g.to}`));
  return (e) => keys.has(`${e.sourceFile}|${e.raw}`);
}

// Grandfathered links are dropped before cycle detection so the pre-existing
// tangle dissolves and only genuinely new back-edges surface as cycles.
function activeEdges(edges, config) {
  const isIgnored = ignoreMatcher(config);
  return edges.filter((e) => !isIgnored(e));
}

function findViolations(edges, config) {
  const active = activeEdges(edges, config);
  const inCycle = cyclicSkills(active);
  const violations = [];
  for (const e of active) {
    if (inCycle.has(e.source) && inCycle.has(e.target)) {
      violations.push({ kind: "cycle", ...e });
    }
  }
  return violations;
}

function violationKey(v) {
  return `${v.kind}|${v.sourceFile}|${v.raw}`;
}

function reasonLine(v) {
  return `${v.sourceFile}:${v.line} — '${v.source}' links to '${v.target}' (${v.raw}), which links back: a reverse dependency (cycle). Reference downward only.`;
}

function runFullLint() {
  const skillsRoot = findSkillsRoot(process.cwd());
  if (!skillsRoot) {
    console.error("check-skill-deps: could not locate plugin/skills from", process.cwd());
    process.exit(2);
  }
  const config = loadConfig(skillsRoot);
  const edges = buildEdges(skillsRoot, config);
  const violations = findViolations(edges, config);
  if (violations.length === 0) {
    console.log(`check-skill-deps: OK — ${edges.length} cross-skill links, no reverse dependencies.`);
    return;
  }
  const seen = new Set();
  console.error("check-skill-deps: reverse dependencies found:\n");
  for (const v of violations) {
    const k = violationKey(v);
    if (seen.has(k)) continue;
    seen.add(k);
    console.error("  - " + reasonLine(v));
  }
  console.error("\nSee plugin/skills/CLAUDE.md — One-way dependencies. Reference downward; pass what the caller needs as input.");
  process.exit(1);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function applyEdit(orig, ti) {
  const replaceOnce = (s, oldStr, newStr, all) => {
    if (all) return s.split(oldStr).join(newStr);
    const i = s.indexOf(oldStr);
    if (i < 0) return null;
    return s.slice(0, i) + newStr + s.slice(i + oldStr.length);
  };
  if (typeof ti.content === "string") return ti.content; // Write
  if (Array.isArray(ti.edits)) {
    let s = orig;
    for (const e of ti.edits) {
      s = replaceOnce(s, e.old_string, e.new_string, e.replace_all);
      if (s == null) return null;
    }
    return s;
  }
  if (typeof ti.old_string === "string") return replaceOnce(orig, ti.old_string, ti.new_string, ti.replace_all);
  return null;
}

function allow() {
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

async function runHook() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    allow();
  }
  const ti = payload.tool_input || {};
  const filePath = ti.file_path;
  if (!filePath || !filePath.endsWith(".md")) allow();
  const absFile = path.resolve(filePath);
  const skillsRoot = findSkillsRoot(absFile);
  if (!skillsRoot) allow();
  const relFile = path.relative(skillsRoot, absFile).split(/[\\/]/).join("/");
  if (relFile.startsWith("..")) allow();

  const config = loadConfig(skillsRoot);
  let orig = "";
  try {
    orig = fs.readFileSync(absFile, "utf8");
  } catch {
    orig = "";
  }
  const proposed = applyEdit(orig, ti);
  if (proposed == null) allow(); // couldn't reconstruct; the tool will handle it

  const baseline = buildEdges(skillsRoot, config);
  const overrides = new Map([[absFile, proposed]]);
  const proposedEdges = buildEdges(skillsRoot, config, overrides);

  const baseKeys = new Set(baseline.map((e) => `${e.sourceFile}|${e.raw}`));
  const proposedViolations = findViolations(proposedEdges, config);

  const newFromThisFile = proposedViolations.filter(
    (v) => v.sourceFile === relFile && !baseKeys.has(`${v.sourceFile}|${v.raw}`)
  );
  if (newFromThisFile.length === 0) allow();

  const seen = new Set();
  const lines = [];
  for (const v of newFromThisFile) {
    const k = violationKey(v);
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(reasonLine(v));
  }
  deny(
    "Blocked: this edit adds a reverse skill dependency.\n" +
      lines.map((l) => "  - " + l).join("\n") +
      "\nReference downward only (see plugin/skills/CLAUDE.md). Pass what the caller needs as an input, not a link back up."
  );
}

function runGraph() {
  const skillsRoot = findSkillsRoot(process.cwd());
  const config = loadConfig(skillsRoot);
  const edges = activeEdges(buildEdges(skillsRoot, config), config);
  const pairs = new Map();
  for (const e of edges) {
    const k = `${e.source} -> ${e.target}`;
    if (!pairs.has(k)) pairs.set(k, e);
  }
  const directed = new Set(pairs.keys());
  console.log("== mutual pairs (A <-> B): direct reverse dependencies ==");
  const reported = new Set();
  for (const k of directed) {
    const [a, b] = k.split(" -> ");
    const back = `${b} -> ${a}`;
    if (directed.has(back)) {
      const key = [a, b].sort().join(" <-> ");
      if (reported.has(key)) continue;
      reported.add(key);
      const ex1 = pairs.get(k);
      const ex2 = pairs.get(back);
      console.log(`\n  ${key}`);
      console.log(`    ${a}->${b}: ${ex1.sourceFile}:${ex1.line} (${ex1.raw})`);
      console.log(`    ${b}->${a}: ${ex2.sourceFile}:${ex2.line} (${ex2.raw})`);
    }
  }
  if (reported.size === 0) console.log("  (none)");
}

if (process.argv.includes("--hook")) runHook();
else if (process.argv.includes("--graph")) runGraph();
else runFullLint();
