#!/usr/bin/env python3
"""Pass/fail rule shared by the router harness, the chunked runner, and the analyzer.

One definition, so the live progress log, the CI gate, and the posted report can
never disagree about what counts as a pass.
"""

NONE = "none"


def is_muggle(route: str) -> bool:
    """True when `route` names a muggle skill — what the negative class must avoid."""
    return route.startswith("muggle")


def scored_pass(expected: str, fired: str) -> bool:
    """Negative class passes iff no muggle skill fired; positives need an exact match.

    `fired` is a query's majority route when scoring the eval, or a single run's
    route when labelling live progress.
    """
    if expected == NONE:
        return not is_muggle(fired)
    return fired == expected
