import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const PLUGIN_REGISTRY_KEY = "muggleai@muggle-works";
const MARKETPLACE_NAME = "muggle-works";
const USER_SCOPE = "user";

/**
 * Outcome of pointing Claude Code at the installed package.
 * @typedef {object} MarketplaceSyncResult
 * @property {boolean} changed - Whether any Claude Code file was rewritten.
 * @property {string} reason - Why the attempt ended the way it did.
 */

/**
 * Read a JSON file, or `fallback` when it does not exist.
 *
 * @param {string} filePath - File to read.
 * @param {object | null} fallback - Value for a missing file.
 * @returns {object | null} The parsed contents.
 * @throws {Error} When the file exists but is not valid JSON.
 */
function readJsonFile(filePath, fallback) {
    if (!existsSync(filePath)) {
        return fallback;
    }
    return JSON.parse(readFileSync(filePath, "utf-8"));
}

function writeJsonFile(filePath, contents) {
    writeFileSync(filePath, `${JSON.stringify(contents, null, 2)}\n`, "utf-8");
}

/**
 * Register the installed package as the `muggle-works` marketplace, so Claude Code loads the
 * plugin in place from this install on the next session or `/reload-plugins`.
 *
 * A git-sourced marketplace resolves the plugin version from the remote's default branch, which
 * never carries a staging build and goes stale between Claude Code's own refreshes; a directory
 * source makes the npm-installed version the one Claude Code runs on either release lane. A
 * marketplace declared in `settings.json` is re-applied at session start and wins over
 * `known_marketplaces.json`, so an existing declaration is repointed too — one is never added.
 *
 * Only acts when the plugin is already installed in Claude Code; it never installs it.
 *
 * @param {object} options
 * @param {string} options.claudeConfigDir - The ~/.claude directory.
 * @param {string} options.packageRootDir - Root of the globally installed `@muggleai/works`.
 * @param {Date} [options.now] - Timestamp for `lastUpdated`; defaults to the current time.
 * @returns {MarketplaceSyncResult} What happened, for the caller to log.
 */
export function pointClaudeMarketplaceAtPackage({ claudeConfigDir, packageRootDir, now = new Date() }) {
    const pluginsDir = join(claudeConfigDir, "plugins");
    const registryPath = join(pluginsDir, "installed_plugins.json");
    const knownMarketplacesPath = join(pluginsDir, "known_marketplaces.json");
    const settingsPath = join(claudeConfigDir, "settings.json");
    const pluginDir = join(packageRootDir, "plugin");
    const pluginManifestPath = join(pluginDir, ".claude-plugin", "plugin.json");

    if (!existsSync(join(packageRootDir, ".claude-plugin", "marketplace.json")) || !existsSync(pluginManifestPath)) {
        return { changed: false, reason: "package ships no Claude marketplace manifest" };
    }

    let registry;
    let knownMarketplaces;
    let settings;
    let packageVersion;
    try {
        registry = readJsonFile(registryPath, null);
        knownMarketplaces = readJsonFile(knownMarketplacesPath, {});
        settings = readJsonFile(settingsPath, null);
        packageVersion = readJsonFile(pluginManifestPath, null).version;
    } catch (error) {
        return { changed: false, reason: `unreadable Claude Code file: ${error.message}` };
    }

    const registryEntries = registry?.plugins?.[PLUGIN_REGISTRY_KEY];
    if (!Array.isArray(registryEntries) || registryEntries.length === 0) {
        return { changed: false, reason: "muggle plugin not installed in Claude Code" };
    }

    const directorySource = { source: "directory", path: packageRootDir };
    const isDirectorySource = (source) => source?.source === directorySource.source && source?.path === directorySource.path;
    const lastUpdated = now.toISOString();

    const knownEntry = knownMarketplaces[MARKETPLACE_NAME];
    const isKnownCurrent = isDirectorySource(knownEntry?.source) && knownEntry.installLocation === packageRootDir;

    const declaredMarketplace = settings?.extraKnownMarketplaces?.[MARKETPLACE_NAME];
    const isDeclarationCurrent = declaredMarketplace === undefined || isDirectorySource(declaredMarketplace.source);

    const userEntry = registryEntries.find((entry) => entry.scope === USER_SCOPE);
    const isUserEntryCurrent = userEntry === undefined || (userEntry.installPath === pluginDir && userEntry.version === packageVersion);

    if (isKnownCurrent && isDeclarationCurrent && isUserEntryCurrent) {
        return { changed: false, reason: `already loading ${packageVersion} from ${packageRootDir}` };
    }

    try {
        if (!isDeclarationCurrent) {
            declaredMarketplace.source = directorySource;
            writeJsonFile(settingsPath, settings);
        }
        if (!isKnownCurrent) {
            knownMarketplaces[MARKETPLACE_NAME] = { source: directorySource, installLocation: packageRootDir, lastUpdated: lastUpdated };
            writeJsonFile(knownMarketplacesPath, knownMarketplaces);
        }
        if (!isUserEntryCurrent) {
            userEntry.installPath = pluginDir;
            userEntry.version = packageVersion;
            userEntry.lastUpdated = lastUpdated;
            writeJsonFile(registryPath, registry);
        }
    } catch (error) {
        return { changed: false, reason: `could not write Claude Code file: ${error.message}` };
    }

    return { changed: true, reason: `loading ${packageVersion} from ${packageRootDir}` };
}
