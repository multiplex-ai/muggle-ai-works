import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { Command } from "commander";

import { getLogger } from "@muggleai/mcp";
import {
  buildPrSectionCommand,
  cleanupCommand,
  doctorCommand,
  helpCommand,
  loginCommand,
  logoutCommand,
  serveCommand,
  setupCommand,
  statusCommand,
  upgradeCommand,
  versionsCommand,
} from "../handlers/index.js";

/**
 * Directory containing this module.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the root package directory from the current module location.
 * Handles both bundled (dist/) and development (packages/commands/src/cli/) contexts.
 */
function getPackageRoot(): string {
  if (__dirname.endsWith("dist")) {
    return resolve(__dirname, "..");
  }
  // Development: packages/commands/src/cli -> 4 levels up
  return resolve(__dirname, "..", "..", "..", "..");
}

/**
 * Package version read from root package.json.
 */
const packageVersion = JSON.parse(
  readFileSync(resolve(getPackageRoot(), "package.json"), "utf-8"),
).version as string;

const logger = getLogger();

/**
 * Create and configure the CLI program.
 *
 * @returns Configured Commander program.
 */
function createProgram (): Command {
  const program = new Command();

  program
    .name("muggle")
    .description("Unified MCP server for Muggle AI — cloud E2E and local E2E testing")
    .version(packageVersion);

  program
    .command("serve")
    .description("Start the MCP server")
    .option("--e2e", "Only enable cloud E2E tools (remote URLs; muggle-remote-* prefix)")
    .option("--local", "Only enable local E2E tools (localhost; muggle-local-* prefix)")
    .option("--stdio", "Use stdio transport (default)")
    .action(serveCommand);

  program
    .command("setup")
    .description("Download/update the Electron app for local testing")
    .option("--force", "Force re-download even if already installed")
    .action(setupCommand);

  program
    .command("upgrade")
    .description("Check for and install the latest electron-app version")
    .option("--force", "Force re-download even if already on latest")
    .option("--check", "Check for updates only, don't download")
    .option("--version <version>", "Download a specific version (e.g., 1.0.2)")
    .action(upgradeCommand);

  program
    .command("versions")
    .description("List installed electron-app versions")
    .action(versionsCommand);

  program
    .command("cleanup")
    .description("Remove old electron-app versions and obsolete skills")
    .option("--all", "Remove all old versions (default: keep one previous)")
    .option("--dry-run", "Show what would be deleted without deleting")
    .option("--skills", "Also clean up obsolete skills from ~/.cursor/skills")
    .action(cleanupCommand);

  program
    .command("doctor")
    .description("Diagnose installation and configuration issues")
    .action(doctorCommand);

  program
    .command("login")
    .description("Authenticate with Muggle AI (uses device code flow)")
    .option("--key-name <name>", "Name for the API key")
    .option("--key-expiry <expiry>", "API key expiry: 30d, 90d, 1y, never", "90d")
    .action(loginCommand);

  program
    .command("logout")
    .description("Clear stored credentials")
    .action(logoutCommand);

  program
    .command("status")
    .description("Show authentication status")
    .action(statusCommand);

  program
    .command("build-pr-section")
    .description("Render a muggle-do PR body evidence block from an e2e report on stdin")
    .option("--max-body-bytes <n>", "Max UTF-8 byte budget for the PR body (default 60000)")
    .action(buildPrSectionCommand);

  program.action(() => {
    helpCommand();
  });

  program.on("command:*", () => {
    helpCommand();
    process.exit(1);
  });

  return program;
}

/**
 * Check if the user is requesting help via "muggle help".
 *
 * @returns True if help was requested and handled.
 */
function handleHelpCommand (): boolean {
  const args = process.argv.slice(2);

  if (args.length === 1 && args[0] === "help") {
    helpCommand();
    return true;
  }

  return false;
}

/**
 * Run the CLI.
 */
export async function runCli (): Promise<void> {
  try {
    if (handleHelpCommand()) {
      return;
    }

    const program = createProgram();
    await program.parseAsync(process.argv);
  } catch (error) {
    logger.error("CLI error", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}
