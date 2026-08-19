"""Types for route detection in the routing eval."""

from dataclasses import dataclass
from enum import Enum


class NoneReason(Enum):
    """Why a session reached no skill — diagnostic only, never a scored route."""

    NO_TOOL_CALL = "no_tool_call"
    ORIENTED_ONLY = "oriented_only"
    # Named for the rule that produces it rather than the behaviour it suggests:
    # a call that is not provably read-only — an unrecognized command verb, a real
    # output redirect, or a writing tool. A session that only looked, using verbs
    # the vocabulary does not know, lands here without having changed anything.
    ACTED_WITHOUT_ROUTING = "acted_without_routing"


@dataclass(frozen=True)
class RouteOutcome:
    """One session's route, carrying why it never routed when the route is `none`."""

    route: str
    none_reason: NoneReason | None
