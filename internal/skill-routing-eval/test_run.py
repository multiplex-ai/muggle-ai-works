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


if __name__ == "__main__":
    unittest.main()
