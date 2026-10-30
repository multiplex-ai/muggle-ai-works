/** Terminal device opened on POSIX systems to reach the user's console past npm's output capture. */
export const POSIX_TERMINAL_DEVICE_PATH = "/dev/tty";

/** Console output device opened on Windows to reach the user's console past npm's output capture. */
export const WINDOWS_TERMINAL_DEVICE_PATH = "\\\\.\\CONOUT$";

/** Documentation page the guide links to. */
export const POST_INSTALL_DOCS_URL = "https://www.muggle-ai.com/muggleTestV0/docs/mcp/mcp-overview";

/** Lines of the guide, in print order. Blank strings are spacing. */
export const POST_INSTALL_GUIDE_LINES = [
    "Muggle AI Works is installed. Next steps:",
    "",
    "  1. Load the tools in your AI client",
    "       Cursor, Windsurf   Restart the client",
    "       Codex              codex plugin marketplace add multiplex-ai/muggle-ai-works",
    "                          codex plugin add muggle@muggle-works",
    "       Claude Code        /plugin marketplace add https://github.com/multiplex-ai/muggle-ai-works",
    "                          /plugin install muggleai@muggle-works",
    "",
    "  2. Save your preferences",
    "       muggle init",
    "",
    "  3. Ask your assistant to test something",
    '       "Test the login flow on my app at http://localhost:3000"',
    '       Claude Code: /mdo "Add a logout button to the header"',
    "",
    "Also useful:",
    "  muggle doctor         Check the install",
    "  muggle setup --force  Re-download the browser runner",
    "  muggle help           Full how-to guide",
    `  Docs: ${POST_INSTALL_DOCS_URL}`,
];
