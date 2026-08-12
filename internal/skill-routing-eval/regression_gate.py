#!/usr/bin/env python3
"""Regression-relative gate for the routing eval.

Routing is stochastic: re-measuring identical descriptions moves a skill's
recall by a few queries, and master's own recall is far from perfect. An
absolute pass bar therefore either fails honest runs or means nothing. This
gate compares a run against a recorded per-skill baseline instead, and fails
only on a drop wider than the baseline's own sampling noise, or on a collapse
toward zero.
"""

import json
import math
from pathlib import Path

from gate_constants import (
    COLLAPSE_RECALL,
    FAILING_STATUSES,
    LAPLACE_PSEUDO_COUNT,
    NOISE_SIGMA_MULTIPLIER,
    PAIRED_MEASUREMENT_FACTOR,
)
from gate_types import RunGateVerdict, SkillGateStatus, SkillGateVerdict
from scoring import scored_pass


def skill_tally(results: list[dict], skill: str) -> tuple[int, int]:
    """Count (passed, total) queries for one expected_skill under the shared pass rule.

    Output shape: `(21, 24)`
    """
    rows = [r for r in results if r["expected_skill"] == skill]
    return sum(1 for r in rows if scored_pass(skill, r["majority"])), len(rows)


def evaluated_skills(results: list[dict]) -> list[str]:
    """Every expected_skill the run collected samples for, sorted."""
    return sorted({r["expected_skill"] for r in results})


def load_baseline(path: Path) -> dict[str, dict]:
    """Read the recorded per-skill tallies from a baseline document.

    Output shape: `{"muggle-test": {"passed": 23, "total": 26}, ...}`
    """
    return json.loads(Path(path).read_text(encoding="utf-8")).get("skills", {})


def build_baseline(results: list[dict], runs_per_query: int, recorded_from: str) -> dict:
    """Turn a sweep's results into a baseline document ready to commit.

    Output shape: `{"recorded_from": "...", "runs_per_query": 3,
    "skills": {"muggle-test": {"passed": 23, "total": 26}}}`
    """
    skills = {}
    for skill in evaluated_skills(results):
        passed, total = skill_tally(results, skill)
        skills[skill] = {"passed": passed, "total": total}
    return {
        "recorded_from": recorded_from,
        "runs_per_query": runs_per_query,
        "skills": skills,
    }


def noise_tolerance(baseline_passed: int, baseline_total: int, observed_total: int) -> float:
    """Recall points a run may sit below baseline before the drop outruns noise."""
    span = min(baseline_total, observed_total)
    if span <= 0:
        return 1.0
    smoothed = (baseline_passed + LAPLACE_PSEUDO_COUNT) / (baseline_total + 2 * LAPLACE_PSEUDO_COUNT)
    sampling_error = math.sqrt(smoothed * (1.0 - smoothed) / span)
    return NOISE_SIGMA_MULTIPLIER * PAIRED_MEASUREMENT_FACTOR * sampling_error


def judge_skill(
    skill: str,
    passed: int,
    total: int,
    baseline_entry: dict | None,
    inconclusive: bool = False,
) -> SkillGateVerdict:
    """Judge one skill's measured recall against its baseline entry."""
    recall = passed / total if total else 0.0
    baseline_total = (baseline_entry or {}).get("total", 0)
    baseline_passed = (baseline_entry or {}).get("passed", 0)
    baseline_recall = baseline_passed / baseline_total if baseline_total else None

    if inconclusive:
        return SkillGateVerdict(skill, passed, total, recall, baseline_recall, 0.0, SkillGateStatus.INCONCLUSIVE)
    if total and recall < COLLAPSE_RECALL:
        return SkillGateVerdict(skill, passed, total, recall, baseline_recall, 0.0, SkillGateStatus.COLLAPSED)
    if baseline_recall is None:
        return SkillGateVerdict(skill, passed, total, recall, None, 0.0, SkillGateStatus.UNBASELINED)

    tolerance = noise_tolerance(baseline_passed, baseline_total, total)
    regressed = recall < baseline_recall - tolerance
    status = SkillGateStatus.REGRESSED if regressed else SkillGateStatus.HELD
    return SkillGateVerdict(skill, passed, total, recall, baseline_recall, tolerance, status)


def judge_run(results: list[dict], baseline: dict[str, dict], inconclusive_skills: set) -> RunGateVerdict:
    """Judge every skill a run measured, and their pooled recall, against the baseline."""
    verdicts = [
        judge_skill(skill, *skill_tally(results, skill), baseline.get(skill), skill in inconclusive_skills)
        for skill in evaluated_skills(results)
    ]

    # Many per-skill dips can each sit inside their own band while the suite as a
    # whole moves; pooling the comparable skills catches that broad drift.
    comparable = [
        v for v in verdicts
        if v.status is not SkillGateStatus.INCONCLUSIVE and baseline.get(v.skill, {}).get("total")
    ]
    observed_total = sum(v.total for v in comparable)
    baseline_passed = sum(baseline[v.skill]["passed"] for v in comparable)
    baseline_total = sum(baseline[v.skill]["total"] for v in comparable)
    if not observed_total or not baseline_total:
        return RunGateVerdict(verdicts, None, None, 0.0, False)

    observed_recall = sum(v.passed for v in comparable) / observed_total
    overall_baseline_recall = baseline_passed / baseline_total
    tolerance = noise_tolerance(baseline_passed, baseline_total, observed_total)
    return RunGateVerdict(
        skill_verdicts=verdicts,
        overall_recall=observed_recall,
        overall_baseline_recall=overall_baseline_recall,
        overall_tolerance=tolerance,
        overall_regressed=observed_recall < overall_baseline_recall - tolerance,
    )


def gate_failures(verdict: RunGateVerdict) -> list[SkillGateVerdict]:
    """The skills whose verdict fails the build."""
    return [v for v in verdict.skill_verdicts if v.status in FAILING_STATUSES]


def format_gate_report(verdict: RunGateVerdict) -> list[str]:
    """Gate lines for the CI log: one row per skill, the pooled row, then the headline.

    Output shape: `["Routing regression gate", "  muggle-test  19/26 = 73.1% ...", "GATE PASSED ..."]`
    """
    lines = ["Routing regression gate (vs recorded baseline)"]
    for v in verdict.skill_verdicts:
        measured = f"{v.passed}/{v.total} = {v.recall:.1%}"
        if v.baseline_recall is None:
            against = "no recorded baseline"
        else:
            against = f"baseline {v.baseline_recall:.1%} - tolerance {v.tolerance:.1%}"
        lines.append(f"  {v.skill:<34} {measured:>16}  {against}  [{v.status.value}]")
    if verdict.overall_recall is not None:
        pooled = f"{verdict.overall_recall:.1%}"
        lines.append(
            f"  {'ALL (pooled)':<34} {pooled:>16}  "
            f"baseline {verdict.overall_baseline_recall:.1%} - tolerance {verdict.overall_tolerance:.1%}"
        )

    failures = gate_failures(verdict)
    if failures:
        for v in failures:
            lines.append(f"GATE FAILED: {v.skill} {v.status.value} — {v.recall:.1%} of {v.total} queries")
    if verdict.overall_regressed:
        lines.append(f"GATE FAILED: pooled recall {verdict.overall_recall:.1%} regressed against baseline")
    if not failures and not verdict.overall_regressed:
        lines.append("GATE PASSED: no skill fell below its baseline by more than routing noise.")
    return lines
