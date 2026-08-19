"""Vocabulary the no-route classifier reads a session's tool calls against."""

REPORT_NONE_REASONS_FIELD = "none_reasons"

# Tools that can only look. A session spending every call here oriented itself
# and stopped, which needs a different fix from one that acted instead.
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
    "git stash list",
    "git status",
    "git worktree list",
    "get-childitem",
    "get-command",
    "get-content",
    "get-item",
    "get-location",
    "grep",
    "measure-object",
    "head",
    "less",
    "ls",
    "printenv",
    "pwd",
    "resolve-path",
    "rg",
    "select-object",
    "select-string",
    "stat",
    "tail",
    "test-path",
    "tree",
    "true",
    "type",
    "wc",
    "where-object",
    "which",
    "whoami",
})

# `gh issue list` is the longest inspection verb, so a command segment's first
# three tokens are enough to recognize one.
MAX_COMMAND_VERB_TOKENS = 3

# A redirect writes a file whatever the verb in front of it reads.
OUTPUT_REDIRECT = ">"

# `2>/dev/null`, `2>$null` and `2>&1` discard or merge a stream rather than write
# one, and they are ordinary punctuation on the end of an orienting command.
DISCARDED_REDIRECT = r"\d*>&?\s*(?:/dev/null|\$null|nul\b|\d)"

# A grouped or piped-into cmdlet arrives as `(Get-Command …).Source`, so the verb
# carries the grouping punctuation into the token that has to be recognized.
COMMAND_VERB_EDGE_CHARS = "(){}"
