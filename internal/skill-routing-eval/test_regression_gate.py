import json
import unittest
from collections import Counter
from pathlib import Path

import regression_gate
from gate_constants import BASELINE_FILENAME
from gate_types import SkillGateStatus

HERE = Path(__file__).resolve().parent

MUGGLE_TEST = "muggle-test"
STEALER = "muggle-do"


def routing_rows(skill, passed, total, missed_route=STEALER):
    """Result rows in which `passed` of `total` queries for `skill` routed correctly."""
    rows = [{"expected_skill": skill, "majority": skill} for _ in range(passed)]
    rows += [{"expected_skill": skill, "majority": missed_route} for _ in range(total - passed)]
    return rows


def status_of(results, baseline, skill, inconclusive=frozenset()):
    verdict = regression_gate.judge_run(results, baseline, inconclusive)
    return next(v for v in verdict.skill_verdicts if v.skill == skill).status


class TestSkillTally(unittest.TestCase):
    def test_positive_skill_counts_exact_routes(self):
        rows = routing_rows(MUGGLE_TEST, 19, 26)
        self.assertEqual(regression_gate.skill_tally(rows, MUGGLE_TEST), (19, 26))

    def test_negative_class_counts_any_non_muggle_route_as_a_pass(self):
        rows = [
            {"expected_skill": "none", "majority": "none"},
            {"expected_skill": "none", "majority": "systematic-debugging"},
            {"expected_skill": "none", "majority": "muggle-repair"},
        ]
        self.assertEqual(regression_gate.skill_tally(rows, "none"), (2, 3))


class TestNoiseTolerance(unittest.TestCase):
    def test_uncertain_baselines_get_a_wider_band(self):
        mid = regression_gate.noise_tolerance(12, 24, 24)
        near_perfect = regression_gate.noise_tolerance(23, 24, 24)
        self.assertGreater(mid, near_perfect)

    def test_larger_query_sets_measure_more_tightly(self):
        small = regression_gate.noise_tolerance(20, 24, 24)
        large = regression_gate.noise_tolerance(200, 240, 240)
        self.assertGreater(small, large)

    def test_a_perfect_baseline_still_has_a_band(self):
        self.assertGreater(regression_gate.noise_tolerance(24, 24, 24), 0.0)


class TestSkillGate(unittest.TestCase):
    baseline = {MUGGLE_TEST: {"passed": 23, "total": 26}}

    def test_a_run_to_run_swing_holds(self):
        rows = routing_rows(MUGGLE_TEST, 19, 26)
        self.assertIs(status_of(rows, self.baseline, MUGGLE_TEST), SkillGateStatus.HELD)

    def test_a_genuine_regression_fails(self):
        rows = routing_rows(MUGGLE_TEST, 12, 26)
        verdict = regression_gate.judge_run(rows, self.baseline, set())
        self.assertIs(verdict.skill_verdicts[0].status, SkillGateStatus.REGRESSED)
        self.assertEqual([v.skill for v in regression_gate.gate_failures(verdict)], [MUGGLE_TEST])

    def test_an_improvement_holds(self):
        rows = routing_rows(MUGGLE_TEST, 26, 26)
        self.assertIs(status_of(rows, self.baseline, MUGGLE_TEST), SkillGateStatus.HELD)

    def test_a_perfect_baseline_absorbs_one_unlucky_query(self):
        baseline = {"muggle-status": {"passed": 24, "total": 24}}
        rows = routing_rows("muggle-status", 23, 24)
        self.assertIs(status_of(rows, baseline, "muggle-status"), SkillGateStatus.HELD)

    def test_a_perfect_baseline_still_catches_a_wide_drop(self):
        baseline = {"muggle-status": {"passed": 24, "total": 24}}
        rows = routing_rows("muggle-status", 18, 24)
        self.assertIs(status_of(rows, baseline, "muggle-status"), SkillGateStatus.REGRESSED)

    def test_a_skill_with_no_recorded_baseline_is_reported_not_failed(self):
        rows = routing_rows("muggle-new", 20, 24)
        verdict = regression_gate.judge_run(rows, self.baseline, set())
        self.assertIs(verdict.skill_verdicts[0].status, SkillGateStatus.UNBASELINED)
        self.assertEqual(regression_gate.gate_failures(verdict), [])

    def test_the_collapse_floor_fails_a_skill_with_no_baseline(self):
        rows = routing_rows("muggle-new", 1, 24)
        verdict = regression_gate.judge_run(rows, self.baseline, set())
        self.assertIs(verdict.skill_verdicts[0].status, SkillGateStatus.COLLAPSED)
        self.assertEqual([v.skill for v in regression_gate.gate_failures(verdict)], ["muggle-new"])

    def test_the_collapse_floor_outranks_a_weak_baseline_wide_band(self):
        baseline = {"muggle": {"passed": 7, "total": 24}}
        rows = routing_rows("muggle", 1, 24)
        self.assertIs(status_of(rows, baseline, "muggle"), SkillGateStatus.COLLAPSED)

    def test_an_inconclusive_chunk_is_not_gated(self):
        rows = routing_rows(MUGGLE_TEST, 0, 26)
        verdict = regression_gate.judge_run(rows, self.baseline, {MUGGLE_TEST})
        self.assertIs(verdict.skill_verdicts[0].status, SkillGateStatus.INCONCLUSIVE)
        self.assertEqual(regression_gate.gate_failures(verdict), [])


class TestPooledGate(unittest.TestCase):
    def test_many_small_dips_together_regress_the_suite(self):
        skills = ["muggle-status", "muggle-repair", "muggle-preferences", "muggle-upgrade", "muggle-feedback"]
        baseline = {s: {"passed": 24, "total": 24} for s in skills}
        rows = [row for s in skills for row in routing_rows(s, 22, 24)]
        verdict = regression_gate.judge_run(rows, baseline, set())
        self.assertTrue(all(v.status is SkillGateStatus.HELD for v in verdict.skill_verdicts))
        self.assertTrue(verdict.overall_regressed)

    def test_a_steady_suite_holds(self):
        skills = ["muggle-status", "muggle-repair", "muggle-preferences"]
        baseline = {s: {"passed": 22, "total": 24} for s in skills}
        rows = [row for s in skills for row in routing_rows(s, 22, 24)]
        verdict = regression_gate.judge_run(rows, baseline, set())
        self.assertFalse(verdict.overall_regressed)

    def test_unbaselined_skills_stay_out_of_the_pooled_comparison(self):
        baseline = {MUGGLE_TEST: {"passed": 23, "total": 26}}
        rows = routing_rows(MUGGLE_TEST, 23, 26) + routing_rows("muggle-new", 12, 24)
        verdict = regression_gate.judge_run(rows, baseline, set())
        self.assertEqual(verdict.overall_recall, 23 / 26)
        self.assertFalse(verdict.overall_regressed)


RUNS_PER_QUERY = 5

# Per-query passes out of 5 that CI measured for muggle-test's 26 queries with its
# description unchanged: two runs inside a stretch where the model routed worse,
# then one twenty minutes later.
DEPRESSED_STRETCH_PASSES = [5] * 10 + [4] * 3 + [3] * 3 + [2] * 5 + [1] * 4 + [0]
DEPRESSED_STRETCH_RERUN_PASSES = [5] * 7 + [4] * 7 + [3] * 2 + [2] * 6 + [1] * 3 + [0]
STEADY_STRETCH_PASSES = [5] * 22 + [4] * 4


def arm_rows(skill, passes_per_query, missed_route="none"):
    """One arm's result rows: query i routed to `skill` on passes_per_query[i] of its runs."""
    rows = []
    for index, passes in enumerate(passes_per_query):
        fired = [skill] * passes + [missed_route] * (RUNS_PER_QUERY - passes)
        majority = skill if passes * 2 > RUNS_PER_QUERY else missed_route
        rows.append({"query": f"{skill} q{index}", "expected_skill": skill, "fired": fired, "majority": majority})
    return rows


def without_most_reliable(passes_per_query, dropped):
    """A real regression: the `dropped` most reliable queries stop routing."""
    ranked = sorted(passes_per_query, reverse=True)
    return [0] * dropped + ranked[dropped:]


def confirmation_status(candidate_passes, control_passes, skill=MUGGLE_TEST):
    verdict = regression_gate.judge_confirmation(
        arm_rows(skill, candidate_passes), arm_rows(skill, control_passes), [skill]
    )
    return verdict.skill_verdicts[0].status


class TestConfirmationAgainstTheControlArm(unittest.TestCase):
    def test_the_depressed_stretch_fails_the_recorded_baseline(self):
        recorded = {MUGGLE_TEST: {"passed": 25, "total": 26}}
        rows = arm_rows(MUGGLE_TEST, DEPRESSED_STRETCH_PASSES)
        self.assertEqual(regression_gate.skill_tally(rows, MUGGLE_TEST), (16, 26))
        self.assertIs(status_of(rows, recorded, MUGGLE_TEST), SkillGateStatus.REGRESSED)

    def test_a_stretch_that_depresses_both_arms_holds(self):
        status = confirmation_status(DEPRESSED_STRETCH_RERUN_PASSES, DEPRESSED_STRETCH_PASSES)
        self.assertIs(status, SkillGateStatus.HELD)

    def test_identical_steady_arms_hold(self):
        self.assertIs(confirmation_status(STEADY_STRETCH_PASSES, STEADY_STRETCH_PASSES), SkillGateStatus.HELD)

    def test_a_drop_the_control_arm_does_not_share_fails(self):
        regressed = without_most_reliable(STEADY_STRETCH_PASSES, 4)
        self.assertIs(confirmation_status(regressed, STEADY_STRETCH_PASSES), SkillGateStatus.REGRESSED)

    def test_a_real_drop_still_fails_inside_a_depressed_stretch(self):
        regressed = without_most_reliable(DEPRESSED_STRETCH_PASSES, 6)
        self.assertIs(confirmation_status(regressed, DEPRESSED_STRETCH_PASSES), SkillGateStatus.REGRESSED)

    def test_an_improvement_holds(self):
        self.assertIs(confirmation_status(STEADY_STRETCH_PASSES, DEPRESSED_STRETCH_PASSES), SkillGateStatus.HELD)

    def test_a_control_arm_that_never_routed_leaves_the_failure_standing(self):
        verdict = regression_gate.judge_confirmation(
            arm_rows(MUGGLE_TEST, STEADY_STRETCH_PASSES), arm_rows(MUGGLE_TEST, [0] * 26), [MUGGLE_TEST]
        )
        self.assertIs(verdict.skill_verdicts[0].status, SkillGateStatus.UNCONFIRMED)
        self.assertTrue(regression_gate.is_failing(verdict))

    def test_a_collapsed_candidate_fails_beside_a_healthy_control(self):
        self.assertIs(confirmation_status([0] * 25 + [1], STEADY_STRETCH_PASSES), SkillGateStatus.COLLAPSED)

    def test_the_verdict_counts_single_runs(self):
        verdict = regression_gate.judge_confirmation(
            arm_rows(MUGGLE_TEST, DEPRESSED_STRETCH_PASSES), arm_rows(MUGGLE_TEST, STEADY_STRETCH_PASSES),
            [MUGGLE_TEST],
        )
        measured = verdict.skill_verdicts[0]
        self.assertEqual((measured.passed, measured.total), (85, 130))
        self.assertAlmostEqual(measured.baseline_recall, 126 / 130)

    def test_a_query_missing_from_one_arm_is_left_out_of_both(self):
        tally = regression_gate.paired_tally(
            arm_rows(MUGGLE_TEST, [5, 5]), arm_rows(MUGGLE_TEST, [5]), MUGGLE_TEST
        )
        self.assertEqual((tally.candidate_passed, tally.control_passed, tally.total), (5, 5, 5))

    def test_borderline_queries_widen_the_band(self):
        reliable = regression_gate.paired_tally(
            arm_rows(MUGGLE_TEST, [5] * 26), arm_rows(MUGGLE_TEST, [5] * 26), MUGGLE_TEST
        )
        borderline = regression_gate.paired_tally(
            arm_rows(MUGGLE_TEST, [3] * 26), arm_rows(MUGGLE_TEST, [3] * 26), MUGGLE_TEST
        )
        self.assertGreater(regression_gate.paired_noise_band(borderline), regression_gate.paired_noise_band(reliable))

    def test_pooled_dips_across_confirmed_skills_regress_together(self):
        skills = ["muggle-status", "muggle-repair", "muggle-preferences", "muggle-upgrade", "muggle-feedback"]
        control = [row for s in skills for row in arm_rows(s, [5] * 24)]
        candidate = [row for s in skills for row in arm_rows(s, [5] * 20 + [3] * 4)]
        verdict = regression_gate.judge_confirmation(candidate, control, skills)
        self.assertTrue(all(v.status is SkillGateStatus.HELD for v in verdict.skill_verdicts))
        self.assertTrue(verdict.overall_regressed)


class TestConfirmationSkills(unittest.TestCase):
    def test_only_the_failing_skills_are_re_measured(self):
        baseline = {MUGGLE_TEST: {"passed": 25, "total": 26}, "muggle-status": {"passed": 24, "total": 24}}
        rows = routing_rows(MUGGLE_TEST, 16, 26) + routing_rows("muggle-status", 24, 24)
        verdict = regression_gate.judge_run(rows, baseline, set())
        self.assertTrue(verdict.overall_regressed)
        self.assertEqual(regression_gate.confirmation_skills(verdict), [MUGGLE_TEST])

    def test_a_pooled_regression_alone_re_measures_every_gated_skill(self):
        skills = ["muggle-status", "muggle-repair", "muggle-preferences", "muggle-upgrade", "muggle-feedback"]
        baseline = {s: {"passed": 24, "total": 24} for s in skills}
        rows = [row for s in skills for row in routing_rows(s, 22, 24)] + routing_rows("muggle-new", 20, 24)
        verdict = regression_gate.judge_run(rows, baseline, {"muggle-feedback"})
        self.assertEqual(regression_gate.gate_failures(verdict), [])
        self.assertTrue(verdict.overall_regressed)
        self.assertEqual(
            regression_gate.confirmation_skills(verdict),
            ["muggle-preferences", "muggle-repair", "muggle-status", "muggle-upgrade"],
        )

    def test_a_passing_verdict_re_measures_nothing(self):
        rows = routing_rows(MUGGLE_TEST, 25, 26)
        verdict = regression_gate.judge_run(rows, {MUGGLE_TEST: {"passed": 25, "total": 26}}, set())
        self.assertEqual(regression_gate.confirmation_skills(verdict), [])


class TestBaselineRecording(unittest.TestCase):
    def test_a_recorded_sweep_judges_itself_as_held(self):
        rows = routing_rows(MUGGLE_TEST, 23, 26) + routing_rows("muggle-repair", 22, 24)
        recorded = regression_gate.build_baseline(rows, 3, "full routing sweep on master")
        self.assertEqual(recorded["skills"][MUGGLE_TEST], {"passed": 23, "total": 26})
        verdict = regression_gate.judge_run(rows, recorded["skills"], set())
        self.assertTrue(all(v.status is SkillGateStatus.HELD for v in verdict.skill_verdicts))
        self.assertFalse(verdict.overall_regressed)


class TestSeededBaseline(unittest.TestCase):
    baseline = json.loads((HERE / BASELINE_FILENAME).read_text(encoding="utf-8"))
    eval_set = json.loads((HERE / "eval-set.json").read_text(encoding="utf-8"))

    def test_every_baselined_skill_still_has_queries_in_the_eval_set(self):
        counts = Counter(q.get("expected_skill", "none") for q in self.eval_set)
        for skill, entry in self.baseline["skills"].items():
            with self.subTest(skill=skill):
                self.assertGreaterEqual(counts[skill], entry["total"])

    def test_the_gate_reads_the_committed_baseline(self):
        loaded = regression_gate.load_baseline(HERE / BASELINE_FILENAME)
        self.assertEqual(loaded, self.baseline["skills"])


if __name__ == "__main__":
    unittest.main()
