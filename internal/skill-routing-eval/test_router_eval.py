import json
import subprocess
import unittest
from unittest import mock

import router_eval
from scoring import scored_pass


def assistant_event(tool_name: str, tool_input: dict) -> str:
    return json.dumps({
        "type": "assistant",
        "message": {"content": [{"type": "tool_use", "name": tool_name, "input": tool_input}]},
    })


def session(*events: str) -> str:
    return "\n".join(events)


class TestParseRouteFromSession(unittest.TestCase):
    def test_skill_tool_call_routes_to_skill(self):
        out = assistant_event("Skill", {"skill": "muggle:muggle-test"})
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-test")

    def test_read_of_skill_md_routes_via_path(self):
        out = assistant_event("Read", {"file_path": "C:\\repo\\plugin\\skills\\muggle-status\\SKILL.md"})
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-status")

    def test_orienting_bash_before_the_skill_still_routes(self):
        out = session(
            assistant_event("Bash", {"command": "git status"}),
            assistant_event("Skill", {"skill": "muggle:muggle-test"}),
        )
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-test")

    def test_orienting_powershell_before_the_skill_still_routes(self):
        out = session(
            assistant_event("PowerShell", {"command": "git diff"}),
            assistant_event("Skill", {"skill": "muggle-do"}),
        )
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-do")

    def test_read_of_a_source_file_does_not_end_the_scan(self):
        out = session(
            assistant_event("Read", {"file_path": "C:\\repo\\src\\index.ts"}),
            assistant_event("Skill", {"skill": "muggle-status"}),
        )
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-status")

    def test_two_tool_calls_in_one_turn_route_on_the_second(self):
        out = json.dumps({
            "type": "assistant",
            "message": {"content": [
                {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}},
                {"type": "tool_use", "name": "Skill", "input": {"skill": "muggle-test"}},
            ]},
        })
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-test")

    def test_session_that_never_routes_is_none(self):
        out = session(
            assistant_event("Bash", {"command": "ls"}),
            assistant_event("Grep", {"pattern": "login"}),
            json.dumps({"type": "result", "result": "answered directly"}),
        )
        self.assertEqual(router_eval.parse_route_from_session(out), router_eval.NONE)

    def test_result_without_tool_call_is_none(self):
        out = json.dumps({"type": "result", "result": "answered directly"})
        self.assertEqual(router_eval.parse_route_from_session(out), router_eval.NONE)

    def test_garbage_lines_are_skipped(self):
        out = "not json\n" + assistant_event("Skill", {"skill": "muggle-do"})
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-do")

    def test_null_tool_input_does_not_crash_the_scan(self):
        out = session(
            json.dumps({
                "type": "assistant",
                "message": {"content": [{"type": "tool_use", "name": "Bash", "input": None}]},
            }),
            assistant_event("Skill", {"skill": "muggle-test"}),
        )
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-test")

    def test_muggle_mcp_tool_call_is_a_muggle_route(self):
        out = assistant_event("mcp__plugin_muggle_muggle__muggle-remote-project-list", {})
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-mcp-tool")

    def test_toolsearch_for_muggle_tools_is_a_muggle_route(self):
        out = assistant_event("ToolSearch", {"query": "select:muggle-remote-project-list"})
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-tools")

    def test_toolsearch_for_unrelated_tools_is_not_a_route(self):
        out = assistant_event("ToolSearch", {"query": "notebook jupyter"})
        self.assertEqual(router_eval.parse_route_from_session(out), router_eval.NONE)


class TestToolRoutesAgainstScoring(unittest.TestCase):
    def test_tool_routes_fail_the_negative_class(self):
        self.assertFalse(scored_pass(router_eval.NONE, "muggle-mcp-tool"))
        self.assertFalse(scored_pass(router_eval.NONE, "muggle-tools"))

    def test_tool_routes_miss_a_query_expecting_a_named_skill(self):
        self.assertFalse(scored_pass("muggle-test", "muggle-mcp-tool"))
        self.assertFalse(scored_pass("muggle-test", "muggle-tools"))

    def test_a_skill_fired_after_orienting_now_fails_the_negative_class(self):
        out = session(
            assistant_event("Bash", {"command": "git status"}),
            assistant_event("Skill", {"skill": "muggle-test"}),
        )
        route = router_eval.parse_route_from_session(out)
        self.assertFalse(scored_pass(router_eval.NONE, route))

    def test_a_non_muggle_skill_still_passes_the_negative_class(self):
        out = session(
            assistant_event("Bash", {"command": "git status"}),
            assistant_event("Skill", {"skill": "superpowers:systematic-debugging"}),
        )
        route = router_eval.parse_route_from_session(out)
        self.assertTrue(scored_pass(router_eval.NONE, route))


class TestRunClaudeOnce(unittest.TestCase):
    def _finished_session(self, returncode: int, stdout: str) -> subprocess.CompletedProcess:
        return subprocess.CompletedProcess(
            args=[], returncode=returncode, stdout=stdout.encode("utf-8"), stderr=b"",
        )

    def test_every_session_gets_the_orient_then_route_turn_budget(self):
        with mock.patch("subprocess.run", return_value=self._finished_session(0, "")) as claude_cli:
            router_eval.run_claude_once("q", ".", 10, None)
        cmd = claude_cli.call_args[0][0]
        self.assertEqual(cmd[cmd.index("--max-turns") + 1], str(router_eval.SESSION_MAX_TURNS))
        self.assertGreaterEqual(router_eval.SESSION_MAX_TURNS, 2)

    def test_turn_cap_reached_after_routing_is_a_completed_session(self):
        out = session(
            assistant_event("Bash", {"command": "git status"}),
            assistant_event("Skill", {"skill": "muggle-test"}),
            json.dumps({"type": "result", "is_error": True, "subtype": "error_max_turns"}),
        )
        with mock.patch("subprocess.run", return_value=self._finished_session(1, out)):
            status, stream = router_eval.run_claude_once("q", ".", 10, None)
        self.assertEqual(status, "OK")
        self.assertEqual(router_eval.parse_route_from_session(stream), "muggle-test")

    def test_rate_limited_session_is_reported_as_throttled(self):
        out = json.dumps({"type": "result", "is_error": True, "result": "rate limit reached"})
        with mock.patch("subprocess.run", return_value=self._finished_session(1, out)):
            status, stream = router_eval.run_claude_once("q", ".", 10, None)
        self.assertEqual(status, "THROTTLED")
        self.assertEqual(stream, "")


class TestStreamErrorText(unittest.TestCase):
    def test_error_result_is_surfaced(self):
        line = json.dumps({"type": "result", "is_error": True, "result": "rate limit reached"})
        self.assertEqual(router_eval.stream_error_text(line), line)

    def test_normal_result_is_not_an_error(self):
        out = json.dumps({"type": "result", "result": "fine"})
        self.assertEqual(router_eval.stream_error_text(out), "")


class TestFormatRunProgress(unittest.TestCase):
    def test_line_carries_the_query(self):
        line = router_eval.format_run_progress(12, 78, "test before I merge", "muggle-test", "muggle-test")
        self.assertIn("test before I merge", line)
        self.assertIn("12/78", line)

    def test_matching_route_is_marked_ok(self):
        line = router_eval.format_run_progress(1, 3, "q", "muggle-test", "muggle-test")
        self.assertIn("ok", line)
        self.assertNotIn("MISS", line)

    def test_wrong_route_is_marked_miss(self):
        line = router_eval.format_run_progress(1, 3, "q", "none", "muggle-test")
        self.assertIn("MISS", line)

    def test_negative_query_passes_on_a_non_muggle_route(self):
        line = router_eval.format_run_progress(1, 3, "q", "systematic-debugging", router_eval.NONE)
        self.assertIn("ok", line)

    def test_negative_query_misses_when_a_muggle_skill_fires(self):
        line = router_eval.format_run_progress(1, 3, "q", "muggle-test", router_eval.NONE)
        self.assertIn("MISS", line)

    def test_long_query_is_truncated_to_one_line(self):
        line = router_eval.format_run_progress(1, 3, "x" * 400, "none", "none")
        self.assertLessEqual(len(line), 200)
        self.assertTrue(line.endswith("..."))

    def test_whitespace_is_collapsed_so_one_run_is_one_line(self):
        line = router_eval.format_run_progress(1, 3, "a\n  b\tc", "none", "none")
        self.assertIn("a b c", line)
        self.assertNotIn("\n", line)

    def test_line_is_ascii_so_windows_consoles_can_encode_it(self):
        line = router_eval.format_run_progress(1, 3, "q", "none", "none")
        line.encode("ascii")


if __name__ == "__main__":
    unittest.main()
