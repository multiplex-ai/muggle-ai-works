#!/usr/bin/env python3
"""Pass/fail rule shared by the router harness, the chunked runner, and the analyzer.

One definition, so the live progress log, the CI gate, and the posted report can
never disagree about what counts as a pass.
"""

from collections import Counter

NONE = "none"

# A run that spent every throttle retry never reached the model, so it says
# nothing about routing. TIMEOUT stays a vote: a session that loops until the
# deadline is routing behavior.
THROTTLED = "THROTTLED"

NO_RESULT_ROUTES = frozenset({THROTTLED})


def is_muggle(route: str) -> bool:
    """True when `route` names a muggle skill — what the negative class must avoid."""
    return route.startswith("muggle")


def is_no_result(route: str) -> bool:
    """True when a run or a query's majority carries no routing evidence."""
    return route in NO_RESULT_ROUTES


def majority_route(runs: list[str]) -> str:
    """A query's most common route among the runs that produced a result.

    Output shape: `"muggle-test"`, or `THROTTLED` when no run got through.
    """
    scored = [route for route in runs if not is_no_result(route)]
    if scored:
        return Counter(scored).most_common(1)[0][0]
    return runs[0] if runs else NONE


def scored_pass(expected: str, fired: str) -> bool:
    """Negative class passes iff no muggle skill fired; positives need an exact match.

    `fired` is a query's majority route when scoring the eval, or a single run's
    route when labelling live progress.
    """
    if expected == NONE:
        return not is_muggle(fired)
    return fired == expected
