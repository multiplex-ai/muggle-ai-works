import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { Command } from "commander";

import { getLogger } from "@muggleai/mcp";
import {
  buildPrSectionCommand,
  checkoutFreshnessCommand,
  ciInstallCommand,
  prWalkthroughCheckCommand,
  runViewCommand,
  cleanupCommand,
  doctorCommand,
  helpCommand,
  initCommand,
  llmSourceCommand,
  loginCommand,
  logoutCommand,
  serveCommand,
  setupCommand,
  stackCheckCommand,
  stackClaimCommand,
  stackReleaseCommand,
  stackStatusCommand,
  statusCommand,
  upgradeCommand,
  versionsCommand,
  watchInstallCommand,
  watchRegisterCommand,
  watchReloadPluginsCommand,
  watchStatusCommand,
  watchTickCommand,
  watchUnregisterCommand,
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
    .command("init")
    .description("Set up Muggle Test — explains how it works and saves your preferences")
    .option("--json", "Emit the walkthrough as JSON instead of prompting")
    .option("--apply <file>", "Apply answers from a JSON file")
    .action(initCommand);

  program
    .command("llm-source")
    .description("Choose who supplies the model for local runs: Muggle AI credit, your Anthropic key, or a local model")
    .option("--show", "Print the source in effect")
    .option("--json", "Emit the question as JSON instead of prompting")
    .option("--use <source>", "Set a source without prompting: muggle-credit, anthropic-api-key, local-model")
    .option("--base-url <url>", "Endpoint URL, with --use local-model")
    .option("--model <name>", "Model served at the endpoint, with --use local-model")
    .action(llmSourceCommand);

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

  program
    .command("run-view")
    .argument("[runId]", "Run id, or a unique prefix of one (default: the newest run)")
    .description("Show a local run's steps beside the frames they produced")
    .option("--html", "Render a self-contained HTML page instead of terminal text")
    .option("--open", "Open the rendered page in the default browser (implies --html)")
    .option("--out-dir <dir>", "Directory to write the page into (default: current directory)")
    .action(runViewCommand);

  program
    .command("pr-walkthrough-check")
    .description("Check that a PR's Muggle AI walkthrough comment carries a result or a stated skip")
    .option("--repo <owner/repo>", "Repository (default: $GITHUB_REPOSITORY)")
    .option("--pr <number>", "Pull request number (default: the Actions event payload)")
    .option("--head-sha <sha>", "Commit the check run attaches to (default: the PR head)")
    .option("--check-run", "Publish the verdict as a check run instead of failing the process")
    .action(prWalkthroughCheckCommand);

  program
    .command("checkout-freshness")
    .description("Fetch the base branch and check that a checkout is built on its latest commit")
    .option("--cwd <dir>", "Directory inside the checkout (default: the current directory)")
    .option("--base <branch>", "Branch the change merges into (default: origin's default branch)")
    .option("--no-fetch", "Check against the last fetched base instead of fetching")
    .option("--json", "Print the full report as JSON")
    .action(checkoutFreshnessCommand);

  const stack = program
    .command("stack")
    .description("Share one set of local services between agents in different checkouts");

  stack
    .command("claim")
    .description("Claim the ports this checkout's E2E run needs; answers granted or busy at once")
    .option("--cwd <dir>", "Directory inside the claiming checkout (default: the current directory)")
    .option(
      "--need <port=run-dir[@sha]>",
      "A port and the directory (and commit) it must serve; repeat per port",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option("--label <name>", "Name shown to peers waiting on this checkout")
    .option("--wait <seconds>", "Keep re-asking this long while busy")
    .option("--json", "Print the full report as JSON")
    .action(stackClaimCommand);

  stack
    .command("check")
    .description("Check that the stack still serves what this checkout claimed, renewing the lease")
    .option("--cwd <dir>", "Directory inside the checkout (default: the current directory)")
    .option("--port <port>", "Port the run will target")
    .option("--json", "Print the full report as JSON")
    .action(stackCheckCommand);

  stack
    .command("release")
    .description("Give up this checkout's lease and place in line")
    .option("--cwd <dir>", "Directory inside the checkout (default: the current directory)")
    .option("--json", "Print the result as JSON")
    .action(stackReleaseCommand);

  stack
    .command("status")
    .description("Show every lease, the line, and the services prepare tracks")
    .option("--json", "Print the full report as JSON")
    .action(stackStatusCommand);

  program
    .command("ci-install")
    .description("Add the Muggle walkthrough check to this repository's GitHub Actions")
    .option("--force", "Replace an existing workflow file")
    .action(ciInstallCommand);

  const watch = program
    .command("watch")
    .description("Standing watch over Claude/Codex sessions, their processes, and PR watchers");

  watch
    .command("tick")
    .description("Run one watch pass (the scheduled task runs this)")
    .option("--no-auto-reload", "Do not start a plugin reload fan-out when installed plugins change")
    .option("--no-recovery", "Report dead watchers without resuming their owner sessions")
    .option("--json", "Print the full snapshot as JSON")
    .action(watchTickCommand);

  watch
    .command("status")
    .description("Show the last watch pass: sessions, processes, PR watches, findings")
    .option("--json", "Print the snapshot as JSON")
    .action(watchStatusCommand);

  watch
    .command("reload-plugins")
    .description("Reload plugins across active Claude sessions (respawns idle background ones)")
    .option("--dry-run", "Show what each session would get without respawning anything")
    .option("--json", "Print the report as JSON")
    .action(watchReloadPluginsCommand);

  watch
    .command("install")
    .description("Schedule the watch with this OS's scheduler, or refresh the entry in place")
    .option("--uninstall", "Remove the task; the ledger is kept")
    .option("--no-wait", "Return once the task is registered, without waiting for its first pass")
    .option("--from-preference", "Act on the autoInstallWatchService preference, as an install or upgrade does")
    .action(watchInstallCommand);

  watch
    .command("register")
    .description("Opt a PR-watch slot into out-of-session recovery")
    .requiredOption("--slot <dir>", "The slot dir under ~/.muggle-ai/muggle-do/sessions")
    .action(watchRegisterCommand);

  watch
    .command("unregister")
    .description("Withdraw a PR-watch slot from recovery (it is still reported on)")
    .requiredOption("--slot <dir>", "The slot dir under ~/.muggle-ai/muggle-do/sessions")
    .action(watchUnregisterCommand);

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
 * @returns True when help was asked for and handled.
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
