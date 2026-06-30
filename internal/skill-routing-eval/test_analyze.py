import unittest

import analyze
import run


class PerSkillReportEmptyInput(unittest.TestCase):
    def test_empty_results_does_not_divide_by_zero(self):
        report = {"model": "m", "runs_per_query": 3, "results": []}
        out = analyze.per_skill_report(report)
        self.assertIn("No routing samples were collected", out)

    def test_normal_results_are_scored(self):
        report = {
            "model": "m",
            "runs_per_query": 1,
            "results": [
                {"query": "q1", "expected_skill": "muggle-test", "majority": "muggle-test", "fired": ["muggle-test"]},
                {"query": "q2", "expected_skill": "muggle-test", "majority": "none", "fired": ["none"]},
                {"query": "q3", "expected_skill": "none", "majority": "debugging", "fired": ["debugging"]},
            ],
        }
        out = analyze.per_skill_report(report)
        # q1 exact match + q3 negative-clean pass; q2 misses → 2 of 3.
        self.assertIn("2/3", out)


class NoCoverageDetection(unittest.TestCase):
    def setUp(self):
        self.by_skill = {"muggle-test": [{"query": "x"}], "none": [{"query": "y"}]}

    def test_all_requested_skills_uncovered(self):
        self.assertTrue(run.has_no_coverage(["muggle-do"], self.by_skill))

    def test_at_least_one_covered(self):
        self.assertFalse(run.has_no_coverage(["muggle-do", "muggle-test"], self.by_skill))

    def test_empty_skill_list(self):
        self.assertTrue(run.has_no_coverage([], self.by_skill))


if __name__ == "__main__":
    unittest.main()
