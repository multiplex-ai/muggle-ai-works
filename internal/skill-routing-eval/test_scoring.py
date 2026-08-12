import unittest

import scoring


class TestScoredPass(unittest.TestCase):
    def test_positive_query_needs_an_exact_match(self):
        self.assertTrue(scoring.scored_pass("muggle-test", "muggle-test"))
        self.assertFalse(scoring.scored_pass("muggle-test", "muggle-test-feature-local"))

    def test_positive_query_fails_when_nothing_routed(self):
        self.assertFalse(scoring.scored_pass("muggle-test", scoring.NONE))

    def test_negative_query_passes_when_no_muggle_skill_fires(self):
        self.assertTrue(scoring.scored_pass(scoring.NONE, scoring.NONE))
        self.assertTrue(scoring.scored_pass(scoring.NONE, "brainstorming"))

    def test_negative_query_fails_when_a_muggle_skill_fires(self):
        self.assertFalse(scoring.scored_pass(scoring.NONE, "muggle-do"))

    def test_infra_statuses_never_pass_a_positive_query(self):
        for status in ("TIMEOUT", "ERROR", "THROTTLED"):
            self.assertFalse(scoring.scored_pass("muggle-test", status))


class TestIsMuggle(unittest.TestCase):
    def test_muggle_routes_are_detected(self):
        self.assertTrue(scoring.is_muggle("muggle-status"))

    def test_other_skills_are_not_muggle(self):
        self.assertFalse(scoring.is_muggle("systematic-debugging"))


if __name__ == "__main__":
    unittest.main()
