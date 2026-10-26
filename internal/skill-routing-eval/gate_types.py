"""Types for the routing regression gate."""

from dataclasses import dataclass
from enum import Enum


class SkillGateStatus(Enum):
    """One skill's gate outcome; REGRESSED, COLLAPSED and UNCONFIRMED are the failing ones."""

    HELD = "held"
    REGRESSED = "regressed"
    COLLAPSED = "collapsed"
    UNBASELINED = "unbaselined"
    INCONCLUSIVE = "inconclusive"
    # The control arm routed none of a confirmation's runs, so there was nothing to
    # confirm against and the failing verdict it was meant to check stands.
    UNCONFIRMED = "unconfirmed"


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
class PairedTally:
    """One skill's single-run passes in both arms of a paired sweep.

    The arms run the same queries the same number of times, so one total serves both.
    """

    candidate_passed: int
    control_passed: int
    total: int
    #: Variance of `control_passed - candidate_passed` if both arms routed alike.
    difference_variance: float


@dataclass(frozen=True)
class RunGateVerdict:
    """Every evaluated skill's verdict, plus the pooled-recall comparison."""

    skill_verdicts: list[SkillGateVerdict]
    overall_recall: float | None
    overall_baseline_recall: float | None
    overall_tolerance: float
    overall_regressed: bool
