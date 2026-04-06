#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const currentFilePath = fileURLToPath(import.meta.url);
const scriptsDirectoryPath = dirname(currentFilePath);
const repositoryRootPath = join(scriptsDirectoryPath, "..");

const contractsPath = join(repositoryRootPath, "config", "compatibility", "contracts.json");
const packageJsonPath = join(repositoryRootPath, "package.json");
const serverJsonPath = join(repositoryRootPath, "server.json");
const claudePluginManifestPath = join(repositoryRootPath, "plugin", ".claude-plugin", "plugin.json");
const cursorPluginManifestPath = join(repositoryRootPath, "plugin", ".cursor-plugin", "plugin.json");
const hooksJsonPath = join(repositoryRootPath, "plugin", "hooks", "hooks.json");
const skillDirectoryPath = join(repositoryRootPath, "plugin", "skills");
const runCliPath = join(repositoryRootPath, "packages", "commands", "src", "cli", "run-cli.ts");

verifyCompatibilityContracts();

/**
 * Verify compatibility contracts for CLI, MCP, plugin, and skills.
 * @returns {void}
 */
function verifyCompatibilityContracts() {
    const contracts = readJsonFile(contractsPath);
    const packageJson = readJsonFile(packageJsonPath);
    const serverJson = readJsonFile(serverJsonPath);
    const claudePluginManifest = readJsonFile(claudePluginManifestPath);
    const cursorPluginManifest = readJsonFile(cursorPluginManifestPath);
    const hooksJson = readJsonFile(hooksJsonPath);
    const runCliSourceCode = readTextFile(runCliPath);

    verifyCliContract({
        cliContract: contracts.cli,
        packageJson: packageJson,
        runCliSourceCode: runCliSourceCode,
    });
    verifyServerContract({
        serverContract: contracts.server,
        serverJson: serverJson,
    });
    verifyPluginContract({
        pluginContract: contracts.plugins,
        claudePluginManifest: claudePluginManifest,
        cursorPluginManifest: cursorPluginManifest,
        hooksJson: hooksJson,
    });
    verifySkillsContract({
        skillsContract: contracts.skills,
    });
    verifyLegacyCompatibilityPolicy({
        policyContract: contracts.compatibilityPolicy,
    });

    console.log("Compatibility contract verification passed.");
}

/**
 * Verify CLI-level contract.
 * @param {{ cliContract: Record<string, unknown>, packageJson: Record<string, unknown>, runCliSourceCode: string }} params
 * @returns {void}
 */
function verifyCliContract({ cliContract, packageJson, runCliSourceCode }) {
    assertValue({
        condition: packageJson.name === cliContract.packageName,
        message: `package.json name (${packageJson.name}) must equal cli.packageName (${cliContract.packageName}).`,
    });
    assertValue({
        condition: packageJson.mcpName === cliContract.mcpName,
        message: `package.json mcpName (${packageJson.mcpName}) must equal cli.mcpName (${cliContract.mcpName}).`,
    });

    const binaryName = cliContract.binaryName;
    assertValue({
        condition: Boolean(packageJson.bin) && packageJson.bin[binaryName],
        message: `package.json bin must include key '${binaryName}'.`,
    });

    for (const requiredCommandName of cliContract.requiredCommands) {
        assertValue({
            condition: runCliSourceCode.includes(`.command("${requiredCommandName}")`),
            message: `CLI command '${requiredCommandName}' is required but not found in run-cli.ts.`,
        });
    }
}

/**
 * Verify MCP server contract.
 * @param {{ serverContract: Record<string, unknown>, serverJson: Record<string, unknown> }} params
 * @returns {void}
 */
function verifyServerContract({ serverContract, serverJson }) {
    assertValue({
        condition: serverJson.name === serverContract.name,
        message: `server.json name (${serverJson.name}) must equal server.name (${serverContract.name}).`,
    });
    assertValue({
        condition: Array.isArray(serverJson.packages) && serverJson.packages.length > 0,
        message: "server.json packages must be a non-empty array.",
    });
    assertValue({
        condition: serverJson.packages[0].identifier === serverContract.packageIdentifier,
        message: `server.json packages[0].identifier (${serverJson.packages[0].identifier}) must equal server.packageIdentifier (${serverContract.packageIdentifier}).`,
    });
}

/**
 * Verify plugin manifests and hooks contract.
 * @param {{ pluginContract: Record<string, unknown>, claudePluginManifest: Record<string, unknown>, cursorPluginManifest: Record<string, unknown>, hooksJson: Record<string, unknown> }} params
 * @returns {void}
 */
function verifyPluginContract({ pluginContract, claudePluginManifest, cursorPluginManifest, hooksJson }) {
    assertValue({
        condition: claudePluginManifest.name === pluginContract.requiredName,
        message: `plugin/.claude-plugin/plugin.json name (${claudePluginManifest.name}) must equal plugins.requiredName (${pluginContract.requiredName}).`,
    });
    assertValue({
        condition: cursorPluginManifest.name === pluginContract.requiredName,
        message: `plugin/.cursor-plugin/plugin.json name (${cursorPluginManifest.name}) must equal plugins.requiredName (${pluginContract.requiredName}).`,
    });

    const sessionStartHooks = hooksJson?.hooks?.SessionStart;
    assertValue({
        condition: Array.isArray(sessionStartHooks) && sessionStartHooks.length > 0,
        message: "plugin/hooks/hooks.json must contain hooks.SessionStart entries.",
    });

    const firstHookCommand = sessionStartHooks?.[0]?.hooks?.[0]?.command;
    assertValue({
        condition: typeof firstHookCommand === "string" && firstHookCommand.includes(pluginContract.requiredHookCommandContains),
        message: `plugin hook command must include '${pluginContract.requiredHookCommandContains}'.`,
    });
}

/**
 * Verify required skill directories exist.
 * @param {{ skillsContract: Record<string, unknown> }} params
 * @returns {void}
 */
function verifySkillsContract({ skillsContract }) {
    assertValue({
        condition: existsSync(skillDirectoryPath),
        message: `Skill directory does not exist: ${skillDirectoryPath}`,
    });

    const skillDirectoryNames = readdirSync(skillDirectoryPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

    for (const requiredDirectoryName of skillsContract.requiredDirectories) {
        assertValue({
            condition: skillDirectoryNames.includes(requiredDirectoryName),
            message: `Required skill directory missing: plugin/skills/${requiredDirectoryName}`,
        });
    }
}

/**
 * Verify legacy compatibility policy values.
 * @param {{ policyContract: Record<string, unknown> }} params
 * @returns {void}
 */
function verifyLegacyCompatibilityPolicy({ policyContract }) {
    const allowedStatusValues = new Set(policyContract.allowedLegacyStatuses);
    const legacyIdentifiers = policyContract.legacyIdentifiers;

    assertValue({
        condition: Array.isArray(legacyIdentifiers),
        message: "compatibilityPolicy.legacyIdentifiers must be an array.",
    });

    for (const legacyIdentifierRecord of legacyIdentifiers) {
        assertValue({
            condition: allowedStatusValues.has(legacyIdentifierRecord.status),
            message: `Invalid legacy status '${legacyIdentifierRecord.status}' for identifier '${legacyIdentifierRecord.identifier}'.`,
        });
    }
}

/**
 * Read a JSON file from disk.
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function readJsonFile(filePath) {
    assertValue({
        condition: existsSync(filePath),
        message: `Required file does not exist: ${filePath}`,
    });

    return JSON.parse(readFileSync(filePath, "utf-8"));
}

/**
 * Read text file from disk.
 * @param {string} filePath
 * @returns {string}
 */
function readTextFile(filePath) {
    assertValue({
        condition: existsSync(filePath),
        message: `Required file does not exist: ${filePath}`,
    });

    return readFileSync(filePath, "utf-8");
}

/**
 * Assert a condition and throw with message on failure.
 * @param {{ condition: boolean, message: string }} params
 * @returns {void}
 */
function assertValue({ condition, message }) {
    if (!condition) {
        throw new Error(message);
    }
}
