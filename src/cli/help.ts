/**
 * Help and usage guidance for muggle CLI.
 * Provides comprehensive how-to guidance for users.
 */

/**
 * Color codes for terminal output.
 */
const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
};

/**
 * Format text with color (respects NO_COLOR environment variable).
 * @param text - Text to format.
 * @param color - Color code to apply.
 * @returns Formatted text.
 */
function colorize(text: string, color: string): string {
  if (process.env.NO_COLOR) {
    return text;
  }
  return `${color}${text}${COLORS.reset}`;
}

/**
 * Format a section header.
 * @param title - Section title.
 * @returns Formatted header.
 */
function header(title: string): string {
  return colorize(`\n${title}`, COLORS.bold + COLORS.cyan);
}

/**
 * Format a command example.
 * @param cmd - Command to format.
 * @returns Formatted command.
 */
function cmd(cmd: string): string {
  return colorize(cmd, COLORS.green);
}

/**
 * Format a path or filename.
 * @param path - Path to format.
 * @returns Formatted path.
 */
function path(path: string): string {
  return colorize(path, COLORS.yellow);
}

/**
 * Get the post-install usage guidance message.
 * @returns Usage guidance string for postinstall.
 */
export function getPostInstallGuidance(): string {
  const lines = [
    "",
    colorize("=".repeat(60), COLORS.cyan),
    colorize("  Muggle AI Works - Installation Complete!", COLORS.bold + COLORS.green),
    colorize("=".repeat(60), COLORS.cyan),
    "",
    header("Quick Start"),
    "",
    "  1. Configure your MCP client (e.g., Cursor):",
    "",
    `     Add to ${path("~/.cursor/mcp.json")}:`,
    "",
    `     ${colorize("{", COLORS.dim)}`,
    `       ${colorize('"mcpServers"', COLORS.yellow)}: {`,
    `         ${colorize('"muggle"', COLORS.yellow)}: {`,
    `           ${colorize('"command"', COLORS.yellow)}: ${colorize('"muggle"', COLORS.green)},`,
    `           ${colorize('"args"', COLORS.yellow)}: [${colorize('"serve"', COLORS.green)}]`,
    `         }`,
    `       }`,
    `     ${colorize("}", COLORS.dim)}`,
    "",
    "  2. Restart your MCP client to load the new tools",
    "",
    "  3. Ask your AI assistant to test your application!",
    "",
    header("Useful Commands"),
    "",
    `  ${cmd("muggle help")}      Show detailed how-to guidance`,
    `  ${cmd("muggle doctor")}    Check installation health`,
    `  ${cmd("muggle status")}    Check authentication status`,
    `  ${cmd("muggle login")}     Login to Muggle AI`,
    "",
    header("Documentation"),
    "",
    `  ${colorize("https://www.muggle-ai.com/muggleTestV0/docs/mcp/mcp-overview", COLORS.blue)}`,
    "",
    colorize("=".repeat(60), COLORS.cyan),
    "",
  ];

  return lines.join("\n");
}

/**
 * Get the comprehensive help guidance message.
 * @returns Full help guidance string.
 */
export function getHelpGuidance(): string {
  const lines = [
    "",
    colorize("=".repeat(70), COLORS.cyan),
    colorize("  Muggle AI Works - Comprehensive How-To Guide", COLORS.bold + COLORS.green),
    colorize("=".repeat(70), COLORS.cyan),
    "",
    header("What is Muggle AI Works?"),
    "",
    "  Muggle AI Works is a Model Context Protocol server that provides AI",
    "  assistants with tools to perform automated QA testing of web applications.",
    "",
    "  It supports both:",
    `    ${colorize("•", COLORS.green)} Cloud QA - Test remote production/staging sites with a public URL`,
    `    ${colorize("•", COLORS.green)} Local QA - Test localhost development servers`,
    "",
    header("Setup Instructions"),
    "",
    `  ${colorize("Step 1:", COLORS.bold)} Configure your MCP client`,
    "",
    `    For ${colorize("Cursor", COLORS.bold)}, edit ${path("~/.cursor/mcp.json")}:`,
    "",
    `    ${colorize("{", COLORS.dim)}`,
    `      ${colorize('"mcpServers"', COLORS.yellow)}: {`,
    `        ${colorize('"muggle"', COLORS.yellow)}: {`,
    `          ${colorize('"command"', COLORS.yellow)}: ${colorize('"muggle"', COLORS.green)},`,
    `          ${colorize('"args"', COLORS.yellow)}: [${colorize('"serve"', COLORS.green)}]`,
    `        }`,
    `      }`,
    `    ${colorize("}", COLORS.dim)}`,
    "",
    `  ${colorize("Step 2:", COLORS.bold)} Restart your MCP client`,
    "",
    `  ${colorize("Step 3:", COLORS.bold)} Start testing! Ask your AI assistant:`,
    `    ${colorize('"Test the login flow on my app at http://localhost:3000"', COLORS.dim)}`,
    "",
    header("CLI Commands"),
    "",
    `  ${colorize("Server Commands:", COLORS.bold)}`,
    `    ${cmd("muggle serve")}            Start MCP server with all tools`,
    `    ${cmd("muggle serve --qa")}       Start with Cloud QA tools only`,
    `    ${cmd("muggle serve --local")}    Start with Local QA tools only`,
    "",
    `  ${colorize("Setup & Diagnostics:", COLORS.bold)}`,
    `    ${cmd("muggle setup")}            Download/update Electron app`,
    `    ${cmd("muggle setup --force")}    Force re-download`,
    `    ${cmd("muggle doctor")}           Diagnose installation issues`,
    `    ${cmd("muggle upgrade")}          Check for updates`,
    `    ${cmd("muggle upgrade --check")}  Check updates without installing`,
    "",
    `  ${colorize("Authentication:", COLORS.bold)}`,
    `    ${cmd("muggle login")}            Login to Muggle AI`,
    `    ${cmd("muggle logout")}           Clear stored credentials`,
    `    ${cmd("muggle status")}           Show authentication status`,
    "",
    `  ${colorize("Maintenance:", COLORS.bold)}`,
    `    ${cmd("muggle versions")}         List installed Electron app versions`,
    `    ${cmd("muggle cleanup")}          Remove old Electron app versions`,
    `    ${cmd("muggle cleanup --all")}    Remove all old versions`,
    "",
    `  ${colorize("Help:", COLORS.bold)}`,
    `    ${cmd("muggle help")}             Show this guide`,
    `    ${cmd("muggle --help")}           Show command synopsis`,
    `    ${cmd("muggle --version")}        Show version`,
    "",
    header("Authentication Flow"),
    "",
    "  Authentication happens automatically when you first use a tool that",
    "  requires it:",
    "",
    `    1. ${colorize("A browser window opens", COLORS.bold)} with a verification code`,
    `    2. ${colorize("Log in", COLORS.bold)} with your Muggle AI account`,
    `    3. ${colorize("The tool call continues", COLORS.bold)} with your credentials`,
    "",
    `  API keys are stored in ${path("~/.muggle-ai/api-key.json")}`,
    "",
    header("Available MCP Tools"),
    "",
    `  ${colorize("Cloud QA Tools:", COLORS.bold)} (prefix: qa_)`,
    "    qa_project_create, qa_project_list, qa_use_case_create_from_prompts,",
    "    qa_test_case_generate_from_prompt, qa_workflow_start_*, etc.",
    "",
    `  ${colorize("Local QA Tools:", COLORS.bold)} (prefix: muggle_)`,
    "    muggle_project_create, muggle_test_case_save,",
    "    muggle_execute_test_generation, muggle_execute_replay,",
    "    muggle_cloud_pull_project, muggle_publish_project, etc.",
    "",
    header("Data Directory"),
    "",
    `  All data is stored in ${path("~/.muggle-ai/")}:`,
    "",
    `    ${path("api-key.json")}         Long-lived API key (auto-generated)`,
    `    ${path("projects/")}            Local test projects`,
    `    ${path("sessions/")}            Test execution sessions`,
    `    ${path("electron-app/")}        Downloaded Electron app binaries`,
    "",
    header("Troubleshooting"),
    "",
    `  ${colorize("Installation issues:", COLORS.bold)}`,
    `    Run ${cmd("muggle doctor")} to diagnose problems`,
    "",
    `  ${colorize("Electron app not found:", COLORS.bold)}`,
    `    Run ${cmd("muggle setup --force")} to re-download`,
    "",
    `  ${colorize("Authentication issues:", COLORS.bold)}`,
    `    Run ${cmd("muggle logout")} then ${cmd("muggle login")}`,
    "",
    `  ${colorize("MCP not working in client:", COLORS.bold)}`,
    "    1. Verify mcp.json configuration",
    "    2. Restart your MCP client",
    `    3. Check ${cmd("muggle doctor")} output`,
    "",
    header("Documentation & Support"),
    "",
    `  Docs:    ${colorize("https://www.muggle-ai.com/muggleTestV0/docs/mcp/mcp-overview", COLORS.blue)}`,
    `  GitHub:  ${colorize("https://github.com/multiplex-ai/muggle-ai-works", COLORS.blue)}`,
    "",
    colorize("=".repeat(70), COLORS.cyan),
    "",
  ];

  return lines.join("\n");
}

/**
 * Help command handler.
 * Prints comprehensive how-to guidance.
 */
export function helpCommand(): void {
  console.log(getHelpGuidance());
}
