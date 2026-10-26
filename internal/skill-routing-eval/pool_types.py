"""Types for the routing eval's pooled sweep."""

from enum import Enum


class SweepArm(Enum):
    """Which plugin a paired sweep's session routed against: the PR's, or the base ref's."""

    CANDIDATE = "candidate"
    CONTROL = "control"
