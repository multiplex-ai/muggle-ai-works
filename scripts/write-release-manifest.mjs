#!/usr/bin/env node

/**
 * Writes dist/release-manifest.json at build time with the canonical runtime
 * release identity fields (release, buildId, commitSha, buildTime, serviceName).
 *
 * Reads CI environment variables with "local" fallbacks so local `npm run build`
 * produces a valid (dev-labeled) manifest without ceremony.
 *
 * The manifest is read at runtime by packages/mcps/src/shared/release_manifest.ts
 * and its values are attached as X-Client-* headers on every outbound HTTP call
 * to backend services, where the backend's clientIdentityMiddleware decorates
 * its own telemetry. See muggle-ai-brain/execution/2026-04-07-release-telemetry-rollout/.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const packageJsonPath = join(repoRoot, "package.json");
const distDir = join(repoRoot, "dist");
const outPath = join(distDir, "release-manifest.json");

const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const buildId = process.env.RELEASE_BUILD_ID || "local";
const commitSha = process.env.RELEASE_COMMIT_SHA || "local";
const buildTime = process.env.RELEASE_TIME || new Date().toISOString();

const manifest = {
    release: pkg.version,
    buildId,
    commitSha,
    buildTime,
    serviceName: "muggle-ai-works-mcp",
};

mkdirSync(distDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`[release-manifest] wrote ${outPath}: ${JSON.stringify(manifest)}`);
