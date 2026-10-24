#!/usr/bin/env python3
"""Regression-relative gate for the routing eval.

Routing is stochastic: re-measuring identical descriptions moves a skill's
recall by a few queries, and master's own recall is far from perfect. An
absolute pass bar therefore either fails honest runs or means nothing. This
gate compares a run against a recorded per-skill baseline instead, and fails
only on a drop wider than the baseline's own sampling noise, or on a collapse
toward zero.

A recorded baseline was measured in another stretch of time, and the model
routes worse in some stretches than others: identical descriptions have scored
16/26 and 26/26 twenty minutes apart. So a scoped run's failing verdict is
confirmed before it fails, against the base ref's plugin measured side by side
with the PR's (`judge_confirmation`).
"""

import json
import math
from pathlib import Path

from gate_constants import (
    COLLAPSE_RECALL,
    FAILING_STATUSES,
    GATE_AGAINST_RECORDED_BASELINE,
    LAPLACE_PSEUDO_COUNT,
    NOISE_SIGMA_MULTIPLIER,
    PAIRED_MEASUREMENT_FACTOR,
)
from gate_types import PairedTally, RunGateVerdict, SkillGateStatus, SkillGateVerdict
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


def is_failing(verdict: RunGateVerdict) -> bool:
    """True when a skill or the pooled recall fails the build."""
    return bool(gate_failures(verdict)) or verdict.overall_regressed


def confirmation_skills(verdict: RunGateVerdict) -> list[str]:
    """The skills a failing verdict re-measures against the control arm before it may fail.

    Failing skills are re-measured alone, and the confirmation's pooled row then
    covers only them. A pooled regression with no failing skill is a claim about
    every comparable skill together, so it re-measures all of them.

    Output shape: `["muggle-test"]`
    """
    failing = [v.skill for v in gate_failures(verdict)]
    if failing or not verdict.overall_regressed:
        return failing
    ungated = (SkillGateStatus.INCONCLUSIVE, SkillGateStatus.UNBASELINED)
    return [v.skill for v in verdict.skill_verdicts if v.status not in ungated]


def paired_tally(candidate_rows: list[dict], control_rows: list[dict], skill: str) -> PairedTally:
    """One skill's single-run passes in each arm, paired query by query.

    Each query's pass rate is pooled across both arms for the variance, so a
    query that routes reliably adds little and the borderline ones carry the
    noise. A query either arm is missing is left out of both.

    Output shape: `PairedTally(candidate_passed=118, control_passed=121, total=130, difference_variance=14.2)`
    """
    control_by_query = {row["query"]: row for row in control_rows if row["expected_skill"] == skill}
    candidate_passed = control_passed = total = 0
    difference_variance = 0.0
    for candidate in (row for row in candidate_rows if row["expected_skill"] == skill):
        control = control_by_query.get(candidate["query"])
        if control is None:
            continue
        query_candidate_passed = sum(1 for route in candidate["fired"] if scored_pass(skill, route))
        query_control_passed = sum(1 for route in control["fired"] if scored_pass(skill, route))
        query_runs = len(candidate["fired"]) + len(control["fired"])
        pooled_rate = (query_candidate_passed + query_control_passed + LAPLACE_PSEUDO_COUNT) / (
            query_runs + 2 * LAPLACE_PSEUDO_COUNT
        )
        candidate_passed += query_candidate_passed
        control_passed += query_control_passed
        total += len(candidate["fired"])
        difference_variance += query_runs * pooled_rate * (1.0 - pooled_rate)
    return PairedTally(candidate_passed, control_passed, total, difference_variance)


def paired_noise_band(tally: PairedTally) -> float:
    """Recall points the candidate arm may sit below the control arm before the drop outruns noise."""
    if tally.total <= 0:
        return 1.0
    return NOISE_SIGMA_MULTIPLIER * math.sqrt(tally.difference_variance) / tally.total


def judge_confirmed_skill(skill: str, tally: PairedTally) -> SkillGateVerdict:
    """Judge one skill's candidate arm against the control arm measured beside it."""
    recall = tally.candidate_passed / tally.total if tally.total else 0.0
    control_recall = tally.control_passed / tally.total if tally.total else 0.0
    if tally.control_passed == 0:
        return SkillGateVerdict(skill, tally.candidate_passed, tally.total, recall, control_recall, 0.0,
                                SkillGateStatus.UNCONFIRMED)
    if recall < COLLAPSE_RECALL:
        return SkillGateVerdict(skill, tally.candidate_passed, tally.total, recall, control_recall, 0.0,
                                SkillGateStatus.COLLAPSED)
    band = paired_noise_band(tally)
    status = SkillGateStatus.REGRESSED if recall < control_recall - band else SkillGateStatus.HELD
    return SkillGateVerdict(skill, tally.candidate_passed, tally.total, recall, control_recall, band, status)


def judge_confirmation(candidate_rows: list[dict], control_rows: list[dict], skills: list[str]) -> RunGateVerdict:
    """Judge a paired sweep's candidate arm against its control arm, per skill and pooled.

    Both arms ran inside the same stretch of time, so a stretch in which the model
    routes worse moves them together and only the PR's own effect separates them.
    """
    tallies = {skill: paired_tally(candidate_rows, control_rows, skill) for skill in skills}
    verdicts = [judge_confirmed_skill(skill, tally) for skill, tally in tallies.items()]
    comparable = [tallies[v.skill] for v in verdicts if v.status is not SkillGateStatus.UNCONFIRMED]
    pooled = PairedTally(
        candidate_passed=sum(t.candidate_passed for t in comparable),
        control_passed=sum(t.control_passed for t in comparable),
        total=sum(t.total for t in comparable),
        difference_variance=sum(t.difference_variance for t in comparable),
    )
    if not pooled.total:
        return RunGateVerdict(verdicts, None, None, 0.0, False)
    recall = pooled.candidate_passed / pooled.total
    control_recall = pooled.control_passed / pooled.total
    band = paired_noise_band(pooled)
    return RunGateVerdict(verdicts, recall, control_recall, band, recall < control_recall - band)


def format_gate_report(verdict: RunGateVerdict, compared_against: str = GATE_AGAINST_RECORDED_BASELINE) -> list[str]:
    """Gate lines for the CI log: one row per skill, the pooled row, then the headline.

    Output shape: `["Routing regression gate (vs ...)", "  muggle-test  19/26 = 73.1% ...", "GATE PASSED ..."]`
    """
    lines = [f"Routing regression gate (vs {compared_against})"]
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
            lines.append(f"GATE FAILED: {v.skill} {v.status.value} — {v.passed}/{v.total} = {v.recall:.1%}")
    if verdict.overall_regressed:
        lines.append(f"GATE FAILED: pooled recall {verdict.overall_recall:.1%} regressed against baseline")
    if not failures and not verdict.overall_regressed:
        lines.append("GATE PASSED: no skill fell below its baseline by more than routing noise.")
    return lines
