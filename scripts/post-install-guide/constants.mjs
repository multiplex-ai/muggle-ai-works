/** Terminal device opened on POSIX systems to reach the user's console past npm's output capture. */
export const POSIX_TERMINAL_DEVICE_PATH = "/dev/tty";

/** Console output device opened on Windows to reach the user's console past npm's output capture. */
export const WINDOWS_TERMINAL_DEVICE_PATH = "\\\\.\\CONOUT$";

/** Documentation page the guide links to. */
export const POST_INSTALL_DOCS_URL = "https://www.muggle-ai.com/muggleTestV0/docs/mcp/mcp-overview";

/** Lines of the guide, in print order. Blank strings are spacing. */
export const POST_INSTALL_GUIDE_LINES = [
    "Muggle AI Works is installed. Here is how to use it.",
    "",
    "Ask your AI assistant in plain English, or run a command:",
    "",
    "  Build a feature and get a pull request",
    '    /mdo "Add a logout button to the header"',
    "    Writes the code and unit tests, checks it in a real browser, opens the PR with",
    "    screenshots, then watches the PR for reviews and CI.",
    "",
    "  Check the changes you just made",
    "    /mtest",
    "    Finds the user flows your diff affects and runs them in a real browser.",
    "",
    "  Test one flow",
    '    "Test the login flow on my app at http://localhost:3000"',
    "",
    "  Do something on a website",
    '    /mbt "Log in to the staging admin and refresh order 1234"',
    "",
    "  Not sure what to run",
    "    /m   opens a menu of every command",
    "",
    "First time:",
    "  muggle init   Save your preferences",
    "  Commands not found? Install the plugin, then restart your client:",
    "    Claude Code   /plugin marketplace add https://github.com/multiplex-ai/muggle-ai-works",
    "                  /plugin install muggleai@muggle-works",
    "    Codex         codex plugin marketplace add multiplex-ai/muggle-ai-works",
    "                  codex plugin add muggle@muggle-works",
    "                  (in Codex, write $muggle:mdo for /mdo)",
    "    Cursor, Windsurf   Restart the client",
    "",
    `Full guide: muggle help    Docs: ${POST_INSTALL_DOCS_URL}`,
];
