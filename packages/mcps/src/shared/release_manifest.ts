/**
 * Release manifest reader for the muggle-ai-works MCP package.
 *
 * The manifest is produced at build time by scripts/write-release-manifest.mjs
 * and written to dist/release-manifest.json (a sibling of the bundled entry
 * point). The reader loads it once at first access and caches the result for
 * the process lifetime. When the manifest is absent (dev mode before first
 * build) or malformed, a DEV fallback is returned so nothing hard-fails.
 *
 * The values flow through install_id and host_detection into the six
 * X-Client-* headers attached by PromptServiceClient.buildHeaders to every
 * outbound backend HTTP call. The backend's clientIdentityMiddleware reads
 * those headers and decorates its own telemetry accordingly.
 *
 * This also retires the hardcoded serverVersion: "1.0.0" in config.ts: the
 * MCP server's serverInfo is now sourced from manifest.release.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export interface IReleaseManifest {
    release: string;
    buildId: string;
    commitSha: string;
    buildTime: string;
    serviceName: string;
}

export const DEV_MANIFEST: IReleaseManifest = {
    release: "dev",
    buildId: "dev",
    commitSha: "dev",
    buildTime: "1970-01-01T00:00:00Z",
    serviceName: "muggle-ai-works-mcp",
};

// When bundled by tsup, this module is inlined into dist/index.js at the repo
// root, and import.meta.url points at that bundled entry. The manifest lives
// as a sibling: dist/release-manifest.json. In dev (ts-node / direct import
// from source), import.meta.url points at packages/mcps/src/shared/
// release_manifest.ts and the manifest doesn't exist — DEV_MANIFEST is used.
const MANIFEST_PATH = (() => {
    try {
        return join(dirname(fileURLToPath(import.meta.url)), "release-manifest.json");
    } catch {
        return "release-manifest.json";
    }
})();

let cachedManifest: IReleaseManifest | undefined;

function isValidManifest(value: unknown): value is IReleaseManifest {
    if (typeof value !== "object" || value === null) return false;
    const m = value as Record<string, unknown>;
    return (
        typeof m.release === "string" &&
        typeof m.buildId === "string" &&
        typeof m.commitSha === "string" &&
        typeof m.buildTime === "string" &&
        typeof m.serviceName === "string"
    );
}

export function readReleaseManifest(): IReleaseManifest {
    if (cachedManifest !== undefined) return cachedManifest;
    try {
        const raw = readFileSync(MANIFEST_PATH, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (!isValidManifest(parsed)) {
            cachedManifest = DEV_MANIFEST;
            return cachedManifest;
        }
        cachedManifest = parsed;
        return cachedManifest;
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
            console.warn(
                "release_manifest: unexpected error reading manifest, using DEV fallback",
                { error: (err as Error).message },
            );
        }
        cachedManifest = DEV_MANIFEST;
        return cachedManifest;
    }
}

// For tests only. Do not call from production code.
export function resetReleaseManifestCacheForTests(): void {
    cachedManifest = undefined;
}
