import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { clearUpgradeNoticeCache } from "../../../scripts/upgrade-notice-cache.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

describe("clearUpgradeNoticeCache", () => {
  it("removes the version lookup and the notice, leaving the rest of the cache", () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "upgrade-notice-cache-"));
    writeFileSync(join(cacheDir, "version-check"), "5.32.0|5.33.0");
    writeFileSync(join(cacheDir, "upgrade-available"), "5.32.0|5.33.0");
    writeFileSync(join(cacheDir, "electron-app-checked"), "");

    clearUpgradeNoticeCache(cacheDir);

    expect(existsSync(join(cacheDir, "version-check"))).toBe(false);
    expect(existsSync(join(cacheDir, "upgrade-available"))).toBe(false);
    expect(existsSync(join(cacheDir, "electron-app-checked"))).toBe(true);
  });

  it("does nothing when the cache was never written", () => {
    expect(() => clearUpgradeNoticeCache(join(tmpdir(), "muggle-cache-that-does-not-exist"))).not.toThrow();
  });
});

// Postinstall imports this file statically, so a tarball without it breaks every install at module load.
describe("upgrade-notice-cache.mjs packaging", () => {
  it("ships in package.json files", () => {
    const packageManifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as { files: string[] };
    expect(packageManifest.files).toContain("scripts/upgrade-notice-cache.mjs");
  });

  it("is required by the publish workflow's tarball check", () => {
    const publishWorkflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "publish-works-to-npm.yml"), "utf-8");
    expect(publishWorkflow).toContain("package/scripts/upgrade-notice-cache.mjs");
  });
});
