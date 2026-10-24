"""Tuning constants for the routing eval's pooled sweep."""

# Every selected skill's queries run in one pool, so no worker idles through a
# chunk's tail. Safe to raise because the throttle gate is the backstop: one 429
# pauses new starts for the whole pool, which a pooled sweep makes true across
# skills for the first time (per-chunk subprocesses each had their own gate).
# Twelve isolated sessions on one subscription token rate-limited each other hard enough to
# corrupt a whole sweep. Fewer workers finish slower and measure something real.
DEFAULT_ROUTING_WORKERS = 6

# A positive-skill chunk that comes back entirely `none` is re-run in a fresh
# subprocess this many times before it is called inconclusive.
MAX_DISCONNECT_ATTEMPTS = 3

# Eval-item and result-row field naming the SweepArm a paired sweep ran a query under.
ARM_FIELD = "arm"

# Eval-item field holding the CLAUDE_CONFIG_DIR a query's sessions run under. Absent,
# a session inherits the runner's own config dir and the plugin installed there.
CLAUDE_CONFIG_DIR_FIELD = "claude_config_dir"
