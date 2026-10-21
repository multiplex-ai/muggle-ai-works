import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { pointClaudeMarketplaceAtPackage } from "../../scripts/claude-marketplace-sync.mjs";

const STAGING_VERSION = "5.22.0-staging.153";
const NOW = new Date("2026-10-21T06:00:00.000Z");
const GIT_SOURCE = { source: "git", url: "https://github.com/multiplex-ai/muggle-ai-works.git" };

let fixtureRoot;
let claudeConfigDir;
let packageRootDir;

const registryPath = () => join(claudeConfigDir, "plugins", "installed_plugins.json");
const knownMarketplacesPath = () => join(claudeConfigDir, "plugins", "known_marketplaces.json");
const settingsPath = () => join(claudeConfigDir, "settings.json");

const writeJson = (filePath, contents) => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(contents, null, 2), "utf-8");
};
const readJson = (filePath) => JSON.parse(readFileSync(filePath, "utf-8"));

const seedPackage = () => {
    writeJson(join(packageRootDir, ".claude-plugin", "marketplace.json"), { name: "muggle-works", plugins: [{ name: "muggleai", source: "./plugin" }] });
    writeJson(join(packageRootDir, "plugin", ".claude-plugin", "plugin.json"), { name: "muggle", version: STAGING_VERSION });
};

const seedInstalledPlugin = () => {
    writeJson(registryPath(), {
        version: 2,
        plugins: {
            "muggleai@muggle-works": [
                { scope: "user", installPath: join(claudeConfigDir, "plugins", "cache", "muggle-works", "muggleai", "5.18.0"), version: "5.18.0" },
                { scope: "project", projectPath: "/work/pinned", installPath: "/cache/5.17.0", version: "5.17.0" },
            ],
            "superpowers@claude-plugins-official": [{ scope: "user", installPath: "/cache/superpowers/7.0.0", version: "7.0.0" }],
        },
    });
    writeJson(knownMarketplacesPath(), {
        "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" } },
        "muggle-works": { source: GIT_SOURCE, installLocation: join(claudeConfigDir, "plugins", "marketplaces", "muggle-works") },
    });
};

const sync = () => pointClaudeMarketplaceAtPackage({ claudeConfigDir: claudeConfigDir, packageRootDir: packageRootDir, now: NOW });

beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "muggle-marketplace-"));
    claudeConfigDir = join(fixtureRoot, ".claude");
    packageRootDir = join(fixtureRoot, "npm", "node_modules", "@muggleai", "works");
});

afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("pointClaudeMarketplaceAtPackage", () => {
    it("repoints a git marketplace at the installed package as a directory source", () => {
        seedPackage();
        seedInstalledPlugin();

        const marketplaceSync = sync();

        expect(marketplaceSync.changed).toBe(true);
        expect(readJson(knownMarketplacesPath())["muggle-works"]).toEqual({
            source: { source: "directory", path: packageRootDir },
            installLocation: packageRootDir,
            lastUpdated: NOW.toISOString(),
        });
        expect(readJson(knownMarketplacesPath())["claude-plugins-official"]).toEqual({ source: { source: "github", repo: "anthropics/claude-plugins-official" } });
    });

    it("points the user-scope entry at the package's plugin directory and staging version", () => {
        seedPackage();
        seedInstalledPlugin();

        sync();

        const registry = readJson(registryPath());
        const [userEntry, projectEntry] = registry.plugins["muggleai@muggle-works"];
        expect(userEntry).toEqual({ scope: "user", installPath: join(packageRootDir, "plugin"), version: STAGING_VERSION, lastUpdated: NOW.toISOString() });
        expect(projectEntry).toEqual({ scope: "project", projectPath: "/work/pinned", installPath: "/cache/5.17.0", version: "5.17.0" });
        expect(registry.plugins["superpowers@claude-plugins-official"]).toEqual([{ scope: "user", installPath: "/cache/superpowers/7.0.0", version: "7.0.0" }]);
    });

    it("repoints a git marketplace declared in settings, which would otherwise be re-applied at session start", () => {
        seedPackage();
        seedInstalledPlugin();
        writeJson(settingsPath(), {
            effortLevel: "xhigh",
            extraKnownMarketplaces: {
                "muggle-works": { source: GIT_SOURCE, autoUpdate: true },
                "everos-plugins": { source: { source: "github", repo: "EverMind-AI/everos-plugins" } },
            },
        });

        sync();

        expect(readJson(settingsPath())).toEqual({
            effortLevel: "xhigh",
            extraKnownMarketplaces: {
                "muggle-works": { source: { source: "directory", path: packageRootDir }, autoUpdate: true },
                "everos-plugins": { source: { source: "github", repo: "EverMind-AI/everos-plugins" } },
            },
        });
    });

    it("never adds a marketplace declaration to settings that lack one", () => {
        seedPackage();
        seedInstalledPlugin();
        const untouchedSettings = '{\n    "effortLevel": "xhigh"\n}';
        writeFileSync(settingsPath(), untouchedSettings, "utf-8");

        sync();

        expect(readFileSync(settingsPath(), "utf-8")).toBe(untouchedSettings);
    });

    it("is a no-op on a second run at the same version", () => {
        seedPackage();
        seedInstalledPlugin();
        sync();
        const registryAfterFirstRun = readFileSync(registryPath(), "utf-8");

        const secondSync = pointClaudeMarketplaceAtPackage({ claudeConfigDir: claudeConfigDir, packageRootDir: packageRootDir, now: new Date("2026-10-22T00:00:00.000Z") });

        expect(secondSync.changed).toBe(false);
        expect(secondSync.reason).toContain("already loading");
        expect(readFileSync(registryPath(), "utf-8")).toBe(registryAfterFirstRun);
    });

    it("leaves Claude Code alone when the muggle plugin is not installed", () => {
        seedPackage();
        writeJson(registryPath(), { version: 2, plugins: {} });

        const marketplaceSync = sync();

        expect(marketplaceSync).toEqual({ changed: false, reason: "muggle plugin not installed in Claude Code" });
        expect(existsSync(knownMarketplacesPath())).toBe(false);
    });

    it("leaves Claude Code alone when it has never been run", () => {
        seedPackage();

        expect(sync().changed).toBe(false);
        expect(existsSync(join(claudeConfigDir, "plugins"))).toBe(false);
    });

    it("skips a package that ships no marketplace manifest", () => {
        seedInstalledPlugin();

        expect(sync()).toEqual({ changed: false, reason: "package ships no Claude marketplace manifest" });
        expect(readJson(knownMarketplacesPath())["muggle-works"].source).toEqual(GIT_SOURCE);
    });

    it("writes nothing when a Claude Code file is unreadable", () => {
        seedPackage();
        seedInstalledPlugin();
        writeFileSync(settingsPath(), "{ not json", "utf-8");
        const registryBefore = readFileSync(registryPath(), "utf-8");

        const marketplaceSync = sync();

        expect(marketplaceSync.changed).toBe(false);
        expect(marketplaceSync.reason).toMatch(/^unreadable Claude Code file/);
        expect(readFileSync(registryPath(), "utf-8")).toBe(registryBefore);
        expect(readJson(knownMarketplacesPath())["muggle-works"].source).toEqual(GIT_SOURCE);
    });
});
