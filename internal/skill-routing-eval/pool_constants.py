"""Tuning constants for the routing eval's pooled sweep."""

# Every selected skill's queries run in one pool, so no worker idles through a
# chunk's tail. Safe to raise because the throttle gate is the backstop: one 429
# pauses new starts for the whole pool, which a pooled sweep makes true across
# skills for the first time (per-chunk subprocesses each had their own gate).
DEFAULT_ROUTING_WORKERS = 12

# A positive-skill chunk that comes back entirely `none` is re-run in a fresh
# subprocess this many times before it is called inconclusive.
MAX_DISCONNECT_ATTEMPTS = 3
