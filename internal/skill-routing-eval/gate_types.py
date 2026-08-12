"""Types for the routing regression gate."""

from dataclasses import dataclass
from enum import Enum


class SkillGateStatus(Enum):
    """One skill's gate outcome; REGRESSED and COLLAPSED are the failing ones."""

    HELD = "held"
    REGRESSED = "regressed"
    COLLAPSED = "collapsed"
    UNBASELINED = "unbaselined"
    INCONCLUSIVE = "inconclusive"


@dataclass(frozen=True)
class SkillGateVerdict:
    """One skill's measured recall judged against its recorded baseline."""

    skill: str
    passed: int
    total: int
    recall: float
    baseline_recall: float | None
    tolerance: float
    status: SkillGateStatus


@dataclass(frozen=True)
class RunGateVerdict:
    """Every evaluated skill's verdict, plus the pooled-recall comparison."""

    skill_verdicts: list[SkillGateVerdict]
    overall_recall: float | None
    overall_baseline_recall: float | None
    overall_tolerance: float
    overall_regressed: bool
