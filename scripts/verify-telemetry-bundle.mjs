#!/usr/bin/env node

// Guards against leaking the private @multiplex-ai/telemetry name into the
// shipped tarball. The package source must stay private; only its compiled JS
// is allowed to ship, bundled into dist/.

import { readFileSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(repoRoot, "package.json");
const distDir = join(repoRoot, "dist");

const FORBIDDEN_IN_PACKAGE_JSON = "@multiplex-ai/telemetry";
const FORBIDDEN_IN_DIST = "@multiplex-ai/telemetry";

function fail(msg) {
    console.error(`[verify-telemetry-bundle] FAIL: ${msg}`);
    process.exit(1);
}

function checkPackageJson() {
    const text = readFileSync(pkgPath, "utf8");
    if (text.includes(FORBIDDEN_IN_PACKAGE_JSON)) {
        fail(`${FORBIDDEN_IN_PACKAGE_JSON} appears in package.json — must not ship publicly.`);
    }
}

function walk(dir, hits) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
            walk(full, hits);
            continue;
        }
        if (!name.endsWith(".js") && !name.endsWith(".mjs") && !name.endsWith(".json") && !name.endsWith(".cjs")) {
            continue;
        }
        const text = readFileSync(full, "utf8");
        if (text.includes(FORBIDDEN_IN_DIST)) {
            hits.push(full);
        }
    }
}

function checkDist() {
    const hits = [];
    walk(distDir, hits);
    if (hits.length > 0) {
        fail(`${FORBIDDEN_IN_DIST} appears in dist files:\n${hits.map((h) => `  - ${h}`).join("\n")}`);
    }
}

checkPackageJson();
checkDist();
console.log("[verify-telemetry-bundle] ok — no @multiplex-ai/telemetry leaks");
