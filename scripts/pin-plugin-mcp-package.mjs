#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const currentFilePath = fileURLToPath(import.meta.url);
const scriptsDirectoryPath = dirname(currentFilePath);
const repositoryRootPath = join(scriptsDirectoryPath, "..");

/** npm package the plugin's MCP configs launch. */
export const MCP_PACKAGE_NAME = "@muggleai/works";

/** Plugin MCP configs that launch the server, relative to the repository root. */
export const PLUGIN_MCP_CONFIG_PATHS = [join("plugin", ".mcp.json"), join("plugin", ".codex-mcp.json")];

/**
 * Whether an `npx` argument names the MCP package, bare or at any version.
 * @param {string} arg - One launch argument.
 * @returns {boolean}
 */
export function isMcpPackageSpec(arg) {
    return arg === MCP_PACKAGE_NAME || arg.startsWith(`${MCP_PACKAGE_NAME}@`);
}

/**
 * Pin the muggle server's `npx` package to an exact version, so the plugin launches the MCP built
 * for its own release lane instead of whatever the npm `latest` tag resolves to.
 *
 * Output shape: `{ mcpServers: { muggle: { command: "npx", args: ["-y", "@muggleai/works@5.24.0-staging.164", "serve"] } } }`
 * @param {{ mcpServers: { muggle: { args: string[] } } }} mcpConfig - Parsed MCP config.
 * @param {string} version - Version to pin to.
 * @returns {{ mcpServers: { muggle: { args: string[] } } }} The config with the package argument pinned.
 * @throws {Error} When the config does not launch the MCP package.
 */
export function pinMcpPackageSpec(mcpConfig, version) {
    const launchArgs = mcpConfig.mcpServers?.muggle?.args ?? [];
    if (!launchArgs.some(isMcpPackageSpec)) {
        throw new Error(`MCP config does not launch ${MCP_PACKAGE_NAME}; nothing to pin.`);
    }
    return {
        ...mcpConfig,
        mcpServers: {
            ...mcpConfig.mcpServers,
            muggle: {
                ...mcpConfig.mcpServers.muggle,
                args: launchArgs.map((arg) => (isMcpPackageSpec(arg) ? `${MCP_PACKAGE_NAME}@${version}` : arg)),
            },
        },
    };
}

function pinPluginMcpConfigs() {
    const { version } = JSON.parse(readFileSync(join(repositoryRootPath, "package.json"), "utf-8"));
    for (const relativePath of PLUGIN_MCP_CONFIG_PATHS) {
        const configPath = join(repositoryRootPath, relativePath);
        const pinnedConfig = pinMcpPackageSpec(JSON.parse(readFileSync(configPath, "utf-8")), version);
        writeFileSync(configPath, `${JSON.stringify(pinnedConfig, null, 2)}\n`, "utf-8");
        console.log(`Pinned ${relativePath} to ${MCP_PACKAGE_NAME}@${version}`);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    pinPluginMcpConfigs();
}
