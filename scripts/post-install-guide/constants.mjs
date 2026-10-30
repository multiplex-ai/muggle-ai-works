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
    "See the menu",
    "  /m   (or /muggle:muggle)   Opens a menu of every command",
    "",
    "Import your existing tests first",
    "  /mimport   (or /muggle:muggle-test-import)",
    "  Example: /mimport import my Playwright tests from ./e2e",
    "",
    "Build something, with acceptance tests",
    "  /mdo   (or /muggle:muggle-do)",
    "  Example: /mdo Add a logout button to the header",
    "  Writes the code and unit tests, checks it in a real browser, opens the PR with",
    "  screenshots, then watches the PR for reviews and CI.",
    "",
    "Run a test, locally or remotely",
    "  /mtest   (or /muggle:muggle-test)",
    "  Example: /mtest check my changes on http://localhost:3000",
    "  Example: /mtest check my changes on https://staging.example.com",
    "",
    "Get run guidance",
    "  muggle help   Full how-to guide, in your terminal",
    "",
    "Manage preferences",
    "  /mprefs   (or /muggle:muggle-preferences)",
    "  Example: /mprefs show my settings",
    "",
    "In Codex, write $muggle:mdo for /mdo.",
    `Docs: ${POST_INSTALL_DOCS_URL}`,
];
