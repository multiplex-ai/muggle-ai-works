/**
 * CLI entry point for @muggleai/mcp.
 * Provides commands for serving MCP, setup, diagnostics, and authentication.
 */

import { Command } from "commander";

import { getLogger } from "../shared/logger.js";

import { doctorCommand } from "./doctor.js";
import { loginCommand, logoutCommand, statusCommand } from "./login.js";
import { serveCommand } from "./serve.js";
import { setupCommand } from "./setup.js";

const logger = getLogger();

/**
 * Create and configure the CLI program.
 * @returns Configured Commander program.
 */
function createProgram(): Command {
  const program = new Command();

  program
    .name("muggle-mcp")
    .description("Unified MCP server for Muggle AI - Cloud QA and Local Testing")
    .version("1.0.0");

  // Serve command (main command)
  program
    .command("serve")
    .description("Start the MCP server")
    .option("--qa", "Only enable Cloud QA tools")
    .option("--local", "Only enable Local QA tools")
    .option("--stdio", "Use stdio transport (default)")
    .action(serveCommand);

  // Setup command
  program
    .command("setup")
    .description("Download/update the Electron app for local testing")
    .option("--force", "Force re-download even if already installed")
    .action(setupCommand);

  // Doctor command
  program
    .command("doctor")
    .description("Diagnose installation and configuration issues")
    .action(doctorCommand);

  // Login command
  program
    .command("login")
    .description("Authenticate with Muggle AI (uses device code flow)")
    .option("--key-name <name>", "Name for the API key")
    .option("--key-expiry <expiry>", "API key expiry: 30d, 90d, 1y, never", "90d")
    .action(loginCommand);

  // Logout command
  program
    .command("logout")
    .description("Clear stored credentials")
    .action(logoutCommand);

  // Status command
  program
    .command("status")
    .description("Show authentication status")
    .action(statusCommand);

  // Default to serve when no command specified
  program.action(() => {
    serveCommand({ stdio: true });
  });

  return program;
}

/**
 * Run the CLI.
 */
export async function runCli(): Promise<void> {
  try {
    const program = createProgram();
    await program.parseAsync(process.argv);
  } catch (error) {
    logger.error("CLI error", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}
