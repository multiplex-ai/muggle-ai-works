import unittest

import pooling
from pool_constants import MAX_DISCONNECT_ATTEMPTS

MUGGLE_TEST = "muggle-test"
MUGGLE_STATUS = "muggle-status"
STEALER = "muggle-do"
NONE = "none"


def rows(skill, passed, total, missed_route=STEALER):
    """Result rows in which `passed` of `total` queries for `skill` routed correctly."""
    out = [{"expected_skill": skill, "majority": skill} for _ in range(passed)]
    out += [{"expected_skill": skill, "majority": missed_route} for _ in range(total - passed)]
    return out


def queries(skill, count):
    return [{"query": f"{skill} q{i}", "expected_skill": skill} for i in range(count)]


class TestPlanPooledItems(unittest.TestCase):
    def test_flattens_every_selected_skill_in_order(self):
        by_skill = {MUGGLE_TEST: queries(MUGGLE_TEST, 2), MUGGLE_STATUS: queries(MUGGLE_STATUS, 3)}
        planned = pooling.plan_pooled_items([MUGGLE_TEST, MUGGLE_STATUS], by_skill)
        self.assertEqual(len(planned), 5)
        self.assertEqual([p["expected_skill"] for p in planned[:2]], [MUGGLE_TEST] * 2)

    def test_skips_a_skill_with_no_queries(self):
        by_skill = {MUGGLE_TEST: queries(MUGGLE_TEST, 2)}
        planned = pooling.plan_pooled_items([MUGGLE_TEST, "muggle-nonexistent"], by_skill)
        self.assertEqual(len(planned), 2)

    def test_scoped_run_pools_only_the_requested_skills(self):
        by_skill = {MUGGLE_TEST: queries(MUGGLE_TEST, 2), MUGGLE_STATUS: queries(MUGGLE_STATUS, 3)}
        planned = pooling.plan_pooled_items([MUGGLE_STATUS], by_skill)
        self.assertEqual({p["expected_skill"] for p in planned}, {MUGGLE_STATUS})


class TestPartitionResultsBySkill(unittest.TestCase):
    def test_regroups_a_pooled_run_by_expected_skill(self):
        pooled = rows(MUGGLE_TEST, 2, 3) + rows(MUGGLE_STATUS, 1, 2)
        grouped = pooling.partition_results_by_skill(pooled, [MUGGLE_TEST, MUGGLE_STATUS])
        self.assertEqual(len(grouped[MUGGLE_TEST]), 3)
        self.assertEqual(len(grouped[MUGGLE_STATUS]), 2)

    def test_keeps_a_key_for_a_skill_that_contributed_no_rows(self):
        grouped = pooling.partition_results_by_skill(rows(MUGGLE_TEST, 1, 1), [MUGGLE_TEST, MUGGLE_STATUS])
        self.assertEqual(grouped[MUGGLE_STATUS], [])

    def test_drops_rows_for_skills_outside_the_selection(self):
        pooled = rows(MUGGLE_TEST, 1, 1) + rows(MUGGLE_STATUS, 1, 1)
        grouped = pooling.partition_results_by_skill(pooled, [MUGGLE_TEST])
        self.assertEqual(list(grouped), [MUGGLE_TEST])
        self.assertEqual(len(grouped[MUGGLE_TEST]), 1)


class TestRecallFromResults(unittest.TestCase):
    def test_counts_exact_routes_for_a_positive_skill(self):
        self.assertAlmostEqual(pooling.recall_from_results(rows(MUGGLE_TEST, 19, 26), MUGGLE_TEST), 19 / 26)

    def test_a_skill_with_no_queries_is_not_a_zero(self):
        self.assertEqual(pooling.recall_from_results([], MUGGLE_TEST), 1.0)

    def test_every_query_stolen_reads_as_zero(self):
        self.assertEqual(pooling.recall_from_results(rows(MUGGLE_TEST, 0, 4), MUGGLE_TEST), 0.0)


class TestResolveDisconnectRetries(unittest.TestCase):
    def test_a_healthy_pool_reruns_nothing(self):
        grouped = {MUGGLE_TEST: rows(MUGGLE_TEST, 3, 4), MUGGLE_STATUS: rows(MUGGLE_STATUS, 2, 4)}
        rerun = []
        _, flagged = pooling.resolve_disconnect_retries(grouped, lambda s: rerun.append(s) or [])
        self.assertEqual(rerun, [])
        self.assertEqual(flagged, [])

    def test_a_zero_skill_is_rerun_alone_and_its_rows_replaced(self):
        grouped = {MUGGLE_TEST: rows(MUGGLE_TEST, 0, 4), MUGGLE_STATUS: rows(MUGGLE_STATUS, 3, 4)}
        rerun = []

        def rerun_skill(skill):
            rerun.append(skill)
            return rows(skill, 3, 4)

        resolved, flagged = pooling.resolve_disconnect_retries(grouped, rerun_skill)
        self.assertEqual(rerun, [MUGGLE_TEST])
        self.assertEqual(flagged, [])
        self.assertAlmostEqual(pooling.recall_from_results(resolved[MUGGLE_TEST], MUGGLE_TEST), 0.75)

    def test_retrying_one_skill_leaves_the_other_pooled_rows_untouched(self):
        healthy = rows(MUGGLE_STATUS, 3, 4)
        grouped = {MUGGLE_TEST: rows(MUGGLE_TEST, 0, 4), MUGGLE_STATUS: healthy}
        resolved, _ = pooling.resolve_disconnect_retries(grouped, lambda s: rows(s, 2, 4))
        self.assertEqual(resolved[MUGGLE_STATUS], healthy)

    def test_a_skill_that_never_recovers_is_flagged_not_failed(self):
        grouped = {MUGGLE_TEST: rows(MUGGLE_TEST, 0, 4)}
        rerun = []

        def rerun_skill(skill):
            rerun.append(skill)
            return rows(skill, 0, 4)

        _, flagged = pooling.resolve_disconnect_retries(grouped, rerun_skill)
        self.assertEqual(flagged, [MUGGLE_TEST])
        self.assertEqual(len(rerun), MAX_DISCONNECT_ATTEMPTS - 1)

    def test_recovery_on_the_final_attempt_still_clears_the_flag(self):
        grouped = {MUGGLE_TEST: rows(MUGGLE_TEST, 0, 4)}
        attempts = []

        def rerun_skill(skill):
            attempts.append(skill)
            return rows(skill, 0, 4) if len(attempts) < MAX_DISCONNECT_ATTEMPTS - 1 else rows(skill, 1, 4)

        _, flagged = pooling.resolve_disconnect_retries(grouped, rerun_skill)
        self.assertEqual(flagged, [])

    def test_the_negative_class_is_never_retried_even_at_zero(self):
        grouped = {NONE: rows(NONE, 0, 4, missed_route=STEALER)}
        rerun = []
        _, flagged = pooling.resolve_disconnect_retries(grouped, lambda s: rerun.append(s) or [])
        self.assertEqual(rerun, [])
        self.assertEqual(flagged, [])

    def test_every_collapsed_skill_is_retried_independently(self):
        grouped = {MUGGLE_TEST: rows(MUGGLE_TEST, 0, 4), MUGGLE_STATUS: rows(MUGGLE_STATUS, 0, 4)}
        rerun = []

        def rerun_skill(skill):
            rerun.append(skill)
            return rows(skill, 2, 4)

        _, flagged = pooling.resolve_disconnect_retries(grouped, rerun_skill)
        self.assertEqual(sorted(rerun), [MUGGLE_STATUS, MUGGLE_TEST])
        self.assertEqual(flagged, [])

    def test_each_retry_is_announced_with_its_attempt_number(self):
        grouped = {MUGGLE_TEST: rows(MUGGLE_TEST, 0, 4)}
        announced = []
        pooling.resolve_disconnect_retries(
            grouped,
            lambda s: rows(s, 0, 4),
            on_retry=lambda skill, attempt, limit: announced.append((skill, attempt, limit)),
        )
        self.assertEqual(announced, [(MUGGLE_TEST, 2, MAX_DISCONNECT_ATTEMPTS), (MUGGLE_TEST, 3, MAX_DISCONNECT_ATTEMPTS)])


if __name__ == "__main__":
    unittest.main()
