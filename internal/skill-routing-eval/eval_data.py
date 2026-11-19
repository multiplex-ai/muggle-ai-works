"""Locates the routing eval's data inside a muggle-ai-brain checkout."""

import os
from pathlib import Path

from eval_data_constants import BRAIN_DIR_ENV_VAR, DEFAULT_BRAIN_DIR, ROUTING_DATA_BRAIN_SUBPATH


def resolve_routing_data_dir(explicit_brain_dir: str | None = None) -> Path:
    """The directory holding the eval set and baselines: under `explicit_brain_dir`, else the brain
    checkout BRAIN_DIR_ENV_VAR names, else DEFAULT_BRAIN_DIR.

    Output shape: `<brain-dir>/eval/skill-routing-eval`.
    """
    brain_dir = explicit_brain_dir or os.environ.get(BRAIN_DIR_ENV_VAR) or DEFAULT_BRAIN_DIR
    return Path(brain_dir, *ROUTING_DATA_BRAIN_SUBPATH)
