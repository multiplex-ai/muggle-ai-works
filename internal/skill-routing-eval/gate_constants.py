"""Tuning constants for the routing regression gate."""

from gate_types import SkillGateStatus

BASELINE_FILENAME = "recall-baseline.json"

BASELINE_SOURCE_FULL_SWEEP = "full routing sweep on master"

# Two-sided ~95% band: a run inside it is indistinguishable from sampling noise.
NOISE_SIGMA_MULTIPLIER = 2.0

# The baseline and the PR run are each one noisy measurement, so their
# difference carries both variances — sqrt(2) wider than a single one's error.
PAIRED_MEASUREMENT_FACTOR = 2 ** 0.5

# Rule-of-succession smoothing. Unsmoothed, a 24/24 baseline has zero measured
# variance, so a single unlucky query would read as a regression.
LAPLACE_PSEUDO_COUNT = 1.0

# Recall this low is broken routing whatever the baseline says — the backstop
# for a skill with no recorded baseline, and for a baseline recorded degraded.
COLLAPSE_RECALL = 0.10

FAILING_STATUSES = (SkillGateStatus.REGRESSED, SkillGateStatus.COLLAPSED)
