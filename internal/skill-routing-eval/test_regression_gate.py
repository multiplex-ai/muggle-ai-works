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
