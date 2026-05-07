#!/usr/bin/env node

// Strips tsup-generated source-path comments that reference
// @muggleai/telemetry from the bundled JS. The telemetry source itself
// is bundled inline; the path comments are informational only and would
// otherwise leak the package name into the published artifact.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const distDir = new URL("../dist/", import.meta.url).pathname.replace(/^\//, "").replace(/^([a-z]):/, "$1:");
const distPath = process.platform === "win32" ? distDir.replace(/\//g, "\\") : "/" + distDir;
// On Windows the URL→path conversion above is messy; just use a relative path.
const target = "./dist";

const PATTERN = /^\/\/.*@muggleai[+/]telemetry.*$\r?\n?/gm;

function processFile(file) {
  const before = readFileSync(file, "utf8");
  const after = before.replace(PATTERN, "");
  if (before !== after) {
    writeFileSync(file, after, "utf8");
    const removed = (before.match(PATTERN) || []).length;
    console.log(`[strip-telemetry-comments] ${file}: removed ${removed} comment line(s)`);
  }
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) walk(full);
    else if (name.endsWith(".js")) processFile(full);
  }
}

walk(target);
