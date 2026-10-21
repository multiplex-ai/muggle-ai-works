"""Constants for running the routing eval's sessions in Codex instead of Claude Code."""

from pathlib import Path

#: The variable the tracer hook reads to find the file it appends tool calls to.
ROUTE_TRACE_ENV = "MUGGLE_ROUTE_TRACE"

#: The `type` every tracer line carries, so it can share a stream with `codex exec --json` events.
ROUTE_TRACE_EVENT_TYPE = "muggle.route_trace"

ROUTE_TRACER_HOOK = Path(__file__).resolve().parent / "codex_route_tracer.mjs"

#: The plugin as Codex names it, from the marketplace this checkout publishes.
CODEX_PLUGIN_ID = "muggle@muggle-works"

# Codex has no turn cap like `claude -p --max-turns`, so the session is ended
# from outside: at its first skill read, or once it has made this many tool
# calls without one — about what the Claude session's two turns of orienting
# spend.
SESSION_MAX_TOOL_CALLS = 6

#: How often the runner reads the trace while a session is live.
TRACE_POLL_SECONDS = 0.25

# Hook trust: a headless run cannot answer Codex's trust prompt, and without the
# bypass the tracer is skipped — and so are the plugin's own hooks, whose
# session context a user who trusted them sees on every session.
CODEX_EXEC_FLAGS = (
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--ephemeral",
    "--dangerously-bypass-hook-trust",
    "--color",
    "never",
)

#: Overrides the sandbox, for a runner where Codex cannot start its own.
SANDBOX_ENV = "MUGGLE_CODEX_SANDBOX"

# Read-only is the closest match to the Claude session, which may look but not
# act without a permission it cannot be granted headless.
DEFAULT_CODEX_SANDBOX = "read-only"
