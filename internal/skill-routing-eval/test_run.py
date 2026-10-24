import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock

import run
from gate_constants import BASELINE_FILENAME, CODEX_BASELINE_FILENAME
from pool_constants import ARM_FIELD, CLAUDE_CONFIG_DIR_FIELD
from pool_types import SweepArm
from route_types import Host


def _main(argv: list[str]) -> tuple[int | None, str]:
    """Run run.py's main with `argv`: its exit code (None when it returned) and what it printed to stderr."""
    with mock.patch.object(sys, "argv", ["run.py", *argv]), redirect_stderr(io.StringIO()) as err:
        try:
            run.main()
            code = None
        except SystemExit as stopped:
            code = stopped.code
    return code, err.getvalue()


class TestRunChunkHost(unittest.TestCase):
    def test_the_router_runs_under_the_requested_host(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "chunk.json"
            out.write_text(json.dumps({"results": []}), encoding="utf-8")
            with mock.patch("subprocess.run") as router:
                run.run_chunk([], out, Path(tmp), 1, 1, 10, Host.CODEX)
        cmd = router.call_args.args[0]
        self.assertEqual(cmd[cmd.index("--host") + 1], "codex")


class TestCodexRunsKeepTheirOwnRecords(unittest.TestCase):
    def test_a_codex_run_reports_and_gates_apart_from_claude(self):
        self.assertNotEqual(run.OUT_DIR_BY_HOST[Host.CODEX], run.OUT_DIR_BY_HOST[Host.CLAUDE])
        self.assertEqual(run.BASELINE_BY_HOST[Host.CLAUDE].name, BASELINE_FILENAME)
        self.assertEqual(run.BASELINE_BY_HOST[Host.CODEX].name, CODEX_BASELINE_FILENAME)

    def test_a_codex_gate_with_no_codex_baseline_fails_instead_of_borrowing_claude_s(self):
        passing = {"results": [{"query": "q", "expected_skill": "muggle-status", "fired": ["muggle-status"],
                                "none_reasons": {}, "majority": "muggle-status", "pass": True, "note": ""}]}
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / CODEX_BASELINE_FILENAME
            baselines = {**run.BASELINE_BY_HOST, Host.CODEX: missing}
            with mock.patch.object(run, "run_chunk", return_value=passing) as chunk, \
                    mock.patch.object(run, "BASELINE_BY_HOST", baselines):
                code, printed = _main(["--skill", "muggle-status", "--host", "codex", "--gate", "--out-dir", tmp, "--runs", "1"])
            self.assertEqual(chunk.call_args.args[-1], Host.CODEX)
            combined = json.loads((Path(tmp) / "combined.json").read_text(encoding="utf-8"))
        self.assertEqual(code, 1)
        self.assertIn(f"no recorded baseline at {missing}", printed)
        self.assertEqual(combined["model"], "codex (run.py)")

    def test_syncing_a_codex_run_needs_its_codex_home(self):
        env = {k: v for k, v in os.environ.items() if k != "CODEX_HOME"}
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(run.codex_session, "prepare_codex_home") as prepare:
            code, printed = _main(["--all", "--host", "codex", "--sync-cache", "--out-dir", tmp])
        self.assertEqual(code, 2)
        self.assertIn("CODEX_HOME", printed)
        prepare.assert_not_called()

    def test_syncing_a_codex_run_reinstalls_the_plugin_from_this_checkout(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"CODEX_HOME": tmp}), \
                mock.patch.object(run.codex_session, "prepare_codex_home") as prepare, \
                mock.patch.object(run, "has_no_coverage", return_value=True):
            code, _printed = _main(["--skill", "muggle-do", "--host", "codex", "--sync-cache", "--out-dir", tmp])
        self.assertIsNone(code)
        codex_home, _codex_bin, checkout = prepare.call_args.args
        self.assertEqual((codex_home, checkout), (Path(tmp), run.REPO_ROOT))


CONFIRMED_SKILL = "muggle-status"
RUNS_PER_QUERY = 5


def result_row(item: dict, passes: int, arm: str | None = None) -> dict:
    """A router_eval result row for `item` that routed correctly on `passes` of its runs."""
    skill = item["expected_skill"]
    fired = [skill] * passes + ["none"] * (RUNS_PER_QUERY - passes)
    majority = skill if passes * 2 > RUNS_PER_QUERY else "none"
    row = {"query": item["query"], "expected_skill": skill, "fired": fired, "none_reasons": {},
           "majority": majority, "pass": majority == skill, "note": ""}
    if arm:
        row[ARM_FIELD] = arm
    return row


def depressed_passes(index: int) -> int:
    """A stretch where a third of the queries route on one run in five."""
    return 1 if index % 3 == 0 else RUNS_PER_QUERY


def steady_passes(_index: int) -> int:
    return RUNS_PER_QUERY


class ScriptedChunks:
    """Stands in for run_chunk: per-query passes for the first sweep, then for each confirmation arm."""

    def __init__(self, first_sweep_passes, candidate_passes, control_passes):
        self.first_sweep_passes = first_sweep_passes
        self.candidate_passes = candidate_passes
        self.control_passes = control_passes
        self.planned = []

    def __call__(self, items, out_file, repo_root, runs, workers, timeout, host):
        self.planned.append(items)
        if len(self.planned) == 1:
            return {"results": [result_row(item, self.first_sweep_passes(i)) for i, item in enumerate(items)]}
        rows = []
        for i, item in enumerate(items):
            query_index = i // 2
            if item[ARM_FIELD] == SweepArm.CANDIDATE.value:
                rows.append(result_row(item, self.candidate_passes(query_index), item[ARM_FIELD]))
            else:
                rows.append(result_row(item, self.control_passes(query_index), item[ARM_FIELD]))
        return {"results": rows}


class TestConfirmationAgainstTheBaseRef(unittest.TestCase):
    def _gate(self, chunks: ScriptedChunks, control_config_dir: str | None) -> tuple[int | None, str, str]:
        with tempfile.TemporaryDirectory() as tmp:
            baseline = Path(tmp) / "baseline.json"
            baseline.write_text(json.dumps({"skills": {CONFIRMED_SKILL: {"passed": 24, "total": 24}}}), encoding="utf-8")
            argv = ["--skill", CONFIRMED_SKILL, "--gate", "--baseline", str(baseline), "--out-dir", tmp,
                    "--runs", str(RUNS_PER_QUERY)]
            if control_config_dir:
                argv += ["--control-config-dir", control_config_dir]
            with mock.patch.object(run, "run_chunk", side_effect=chunks):
                code, printed = _main(argv)
            report = (Path(tmp) / "combined.md").read_text(encoding="utf-8")
        return code, printed, report

    def test_a_drop_both_arms_share_passes(self):
        chunks = ScriptedChunks(depressed_passes, depressed_passes, depressed_passes)
        code, printed, report = self._gate(chunks, "/runner/.cc-config-control")
        self.assertIsNone(code)
        self.assertEqual(len(chunks.planned), 2)
        self.assertIn(f"Confirming {CONFIRMED_SKILL}", printed)
        self.assertIn("## Regression gate", report)
        self.assertIn("[held]", report)

    def test_a_drop_only_the_candidate_shows_still_fails(self):
        chunks = ScriptedChunks(depressed_passes, depressed_passes, steady_passes)
        code, _printed, report = self._gate(chunks, "/runner/.cc-config-control")
        self.assertEqual(code, 1)
        self.assertEqual(report.count("[regressed]"), 2)

    def test_the_confirmation_pairs_every_failing_query_with_the_control_dir(self):
        chunks = ScriptedChunks(depressed_passes, depressed_passes, depressed_passes)
        self._gate(chunks, "/runner/.cc-config-control")
        first_sweep, confirmation = chunks.planned
        self.assertEqual(len(confirmation), 2 * len(first_sweep))
        control_dirs = {
            item.get(CLAUDE_CONFIG_DIR_FIELD) for item in confirmation if item[ARM_FIELD] == SweepArm.CONTROL.value
        }
        self.assertEqual(control_dirs, {"/runner/.cc-config-control"})

    def test_without_a_control_dir_the_first_verdict_decides(self):
        chunks = ScriptedChunks(depressed_passes, depressed_passes, depressed_passes)
        code, _printed, _report = self._gate(chunks, None)
        self.assertEqual(code, 1)
        self.assertEqual(len(chunks.planned), 1)

    def test_a_passing_gate_runs_no_confirmation(self):
        chunks = ScriptedChunks(steady_passes, depressed_passes, steady_passes)
        code, printed, _report = self._gate(chunks, "/runner/.cc-config-control")
        self.assertIsNone(code)
        self.assertEqual(len(chunks.planned), 1)
        self.assertNotIn("Confirming", printed)

    def test_a_codex_run_refuses_a_claude_control_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, printed = _main(["--skill", CONFIRMED_SKILL, "--host", "codex", "--out-dir", tmp,
                                   "--control-config-dir", tmp])
        self.assertEqual(code, 2)
        self.assertIn("CODEX_HOME", printed)


if __name__ == "__main__":
    unittest.main()
