"""Vocabulary the no-route classifier reads a session's tool calls against."""

REPORT_NONE_REASONS_FIELD = "none_reasons"

# Tools that can only look. A session spending every call here oriented itself
# and stopped, which needs a different fix from one that did the work by hand.
INSPECTION_TOOL_NAMES = frozenset({
    "Glob",
    "Grep",
    "NotebookRead",
    "Read",
    "ToolSearch",
    "WebFetch",
    "WebSearch",
})

SHELL_TOOL_NAMES = frozenset({"Bash", "PowerShell"})

# Shell verbs that report state without changing it. Anything unlisted counts as
# substantive work, so an unfamiliar command is never mistaken for orienting.
INSPECTION_COMMANDS = frozenset({
    "cat",
    "cd",
    "dir",
    "echo",
    "file",
    "find",
    "gh issue list",
    "gh issue view",
    "gh pr diff",
    "gh pr list",
    "gh pr view",
    "gh repo view",
    "git branch",
    "git config",
    "git diff",
    "git log",
    "git ls-files",
    "git remote",
    "git rev-parse",
    "git show",
    "git status",
    "get-childitem",
    "get-content",
    "get-item",
    "get-location",
    "grep",
    "head",
    "less",
    "ls",
    "printenv",
    "pwd",
    "resolve-path",
    "rg",
    "select-string",
    "stat",
    "tail",
    "test-path",
    "tree",
    "type",
    "wc",
    "which",
    "whoami",
})

# `gh issue list` is the longest inspection verb, so a command segment's first
# three tokens are enough to recognize one.
MAX_COMMAND_VERB_TOKENS = 3

# A redirect writes a file whatever the verb in front of it reads.
OUTPUT_REDIRECT = ">"
