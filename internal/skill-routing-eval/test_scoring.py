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


class TestMajorityRoute(unittest.TestCase):
    def test_the_most_common_route_wins(self):
        self.assertEqual(scoring.majority_route(["muggle-test", "none", "muggle-test"]), "muggle-test")

    def test_a_rate_limited_run_casts_no_vote(self):
        runs = [scoring.THROTTLED, scoring.THROTTLED, "muggle-test"]
        self.assertEqual(scoring.majority_route(runs), "muggle-test")

    def test_a_query_with_only_rate_limited_runs_has_no_result(self):
        majority = scoring.majority_route([scoring.THROTTLED] * 3)
        self.assertTrue(scoring.is_no_result(majority))

    def test_a_query_that_never_ran_routed_nowhere(self):
        self.assertEqual(scoring.majority_route([]), scoring.NONE)

    def test_a_timeout_still_votes_because_a_looping_session_is_routing_behavior(self):
        self.assertFalse(scoring.is_no_result("TIMEOUT"))
        self.assertEqual(scoring.majority_route(["TIMEOUT", "TIMEOUT", "muggle-test"]), "TIMEOUT")


class TestIsMuggle(unittest.TestCase):
    def test_muggle_routes_are_detected(self):
        self.assertTrue(scoring.is_muggle("muggle-status"))

    def test_other_skills_are_not_muggle(self):
        self.assertFalse(scoring.is_muggle("systematic-debugging"))


if __name__ == "__main__":
    unittest.main()
