"""Where the routing eval's queries and baselines live: a muggle-ai-brain checkout."""

BRAIN_DIR_ENV_VAR = "MUGGLE_BRAIN_DIR"

# A sibling of this checkout; a relative brain dir resolves against the working directory.
DEFAULT_BRAIN_DIR = "../muggle-ai-brain"

ROUTING_DATA_BRAIN_SUBPATH = ("eval", "skill-routing-eval")

EVAL_SET_FILENAME = "eval-set.json"
