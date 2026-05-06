#!/usr/bin/env node

// Fetches the private @multiplex-ai/telemetry source into vendor/telemetry/.
// Resolution order:
//   1. MUGGLE_TELEMETRY_DEV_PATH env var → copy from local clone (fast dev loop).
//   2. MUGGLE_TELEMETRY_REPO_URL + MUGGLE_TELEMETRY_REF env vars → git clone.
//   3. Default: clone git@github.com:multiplex-ai/muggle-ai-telemetry.git@main.
// On any failure a no-op stub is written so typecheck/build keep working
// — the resulting bundle just won't emit telemetry. No secret material is
// referenced at runtime; the cloned source is bundled into dist by tsup.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const currentFilePath = fileURLToPath(import.meta.url);
const repoRoot = join(dirname(currentFilePath), "..");
// Vendor inside packages/mcps/src so it sits under that package's rootDir.
// The folder is gitignored — see .gitignore.
const vendorDir = join(repoRoot, "packages", "mcps", "src", "_telemetry", "_vendor");
const vendorSrcDir = vendorDir;

const DEFAULT_REPO_URL = "git@github.com:multiplex-ai/muggle-ai-telemetry.git";
const DEFAULT_REF = "main";

function clean() {
    rmSync(vendorDir, { recursive: true, force: true });
    mkdirSync(vendorDir, { recursive: true });
}

function pruneTests(dir) {
    // Remove *.test.ts so vendored sources don't drag vitest types into our typecheck.
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            pruneTests(full);
        } else if (name.endsWith(".test.ts") || name.endsWith(".test.js")) {
            unlinkSync(full);
        }
    }
}

function copyFromLocal(localPath) {
    const localSrc = join(localPath, "src");
    if (!existsSync(localSrc)) {
        throw new Error(`MUGGLE_TELEMETRY_DEV_PATH src dir not found: ${localSrc}`);
    }
    cpSync(localSrc, vendorSrcDir, { recursive: true });
    pruneTests(vendorSrcDir);
    console.log(`[fetch-telemetry] copied from ${localPath}`);
}

function cloneRepo(repoUrl, ref) {
    const tmpDir = join(vendorDir, ".clone");
    rmSync(tmpDir, { recursive: true, force: true });
    execSync(`git clone --depth 1 --branch ${ref} ${repoUrl} ${tmpDir}`, {
        stdio: "inherit",
    });
    cpSync(join(tmpDir, "src"), vendorSrcDir, { recursive: true });
    rmSync(tmpDir, { recursive: true, force: true });
    pruneTests(vendorSrcDir);
    console.log(`[fetch-telemetry] cloned ${repoUrl}@${ref}`);
}

function writeStub() {
    // Minimal source-shape stub so tsc + tsup still compile when the private
    // source can't be fetched. Bundle becomes a no-op for telemetry calls.
    mkdirSync(vendorSrcDir, { recursive: true });
    writeFileSync(
        join(vendorSrcDir, "index.ts"),
        STUB_INDEX_TS,
        "utf8",
    );
    console.warn("[fetch-telemetry] using stub — telemetry will be a no-op");
}

const STUB_INDEX_TS = `// Auto-generated stub. Real telemetry source unavailable in this build.
// All exports are no-ops with the same shape as @multiplex-ai/telemetry.

export type Trigger = "user-slash" | "claude-proactive" | "nested-skill";
export type Outcome = "success" | "error" | "cancelled";
export type ToolSurface = "local" | "remote";
export type Surface = "mcp-local" | "mcp-remote" | "skill" | "electron";
export type ServiceName = "muggle-mcp" | "muggle-electron" | "muggle-skill";

export type TelemetryEvent =
    | { name: "skill.invoked"; props: { skillName: string; trigger: Trigger } }
    | { name: "skill.completed"; props: { skillName: string; durationMs: number; outcome: Outcome } }
    | { name: "mcp.tool.invoked"; props: { toolName: string; toolSurface: ToolSurface; correlationId: string } }
    | { name: "mcp.tool.completed"; props: { toolName: string; toolSurface: ToolSurface; correlationId: string; durationMs: number; outcome: Outcome; errorCode?: string } }
    | { name: "system.startup"; props: { serviceName: ServiceName } }
    | { name: "system.opt_out_changed"; props: { from: boolean; to: boolean } }
    | { name: "system.disclosure_shown"; props: Record<string, never> };

export type EventName = TelemetryEvent["name"];

export interface InitOptions {
    serviceName: ServiceName;
    surface: Surface;
    connectionString?: string;
}

export function initTelemetry(_opts: InitOptions): void { /* stub */ }
export function isInitialized(): boolean { return false; }
export function resetClientForTests(): void { /* stub */ }
export function track(_event: TelemetryEvent): void { /* stub */ }
export function isTelemetryEnabled(): boolean { return false; }
export function setTelemetryEnabled(_enabled: boolean): void { /* stub */ }
export const DISCLOSURE_COPY = "";
export function getDisclosureCopy(): string { return ""; }
export function hasShownDisclosure(): boolean { return false; }
export function markDisclosureShown(): void { /* stub */ }
export function getInstallId(): string { return ""; }
export interface ReleaseManifest {
    release: string;
    buildId: string;
    commitSha: string;
    buildTime: string;
    serviceName: string;
}
export const DEV_MANIFEST: ReleaseManifest = {
    release: "dev", buildId: "dev", commitSha: "dev",
    buildTime: "1970-01-01T00:00:00Z", serviceName: "stub",
};
export function readReleaseManifest(): ReleaseManifest { return DEV_MANIFEST; }
`;

function main() {
    const devPath = process.env.MUGGLE_TELEMETRY_DEV_PATH;
    const repoUrl = process.env.MUGGLE_TELEMETRY_REPO_URL ?? DEFAULT_REPO_URL;
    const ref = process.env.MUGGLE_TELEMETRY_REF ?? DEFAULT_REF;
    const allowStubFallback = process.env.MUGGLE_TELEMETRY_ALLOW_STUB !== "0";

    clean();

    try {
        if (devPath) {
            copyFromLocal(devPath);
            return;
        }
        cloneRepo(repoUrl, ref);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[fetch-telemetry] fetch failed: ${message}`);
        if (!allowStubFallback) {
            throw err;
        }
        writeStub();
    }
}

main();
