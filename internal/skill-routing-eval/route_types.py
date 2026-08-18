"""Types for route detection in the routing eval."""

from dataclasses import dataclass
from enum import Enum


class NoneReason(Enum):
    """Why a session reached no skill — diagnostic only, never a scored route."""

    NO_TOOL_CALL = "no_tool_call"
    ORIENTED_ONLY = "oriented_only"
    WORKED_BY_HAND = "worked_by_hand"


@dataclass(frozen=True)
class RouteOutcome:
    """One session's route, carrying why it never routed when the route is `none`."""

    route: str
    none_reason: NoneReason | None
