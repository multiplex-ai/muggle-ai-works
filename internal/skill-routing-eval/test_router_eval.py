import json
import unittest

import router_eval


def assistant_event(tool_name: str, tool_input: dict) -> str:
    return json.dumps({
        "type": "assistant",
        "message": {"content": [{"type": "tool_use", "name": tool_name, "input": tool_input}]},
    })


class TestParseRouteFromStream(unittest.TestCase):
    def test_skill_tool_call_routes_to_skill(self):
        out = assistant_event("Skill", {"skill": "muggle:muggle-test"})
        self.assertEqual(router_eval.parse_route_from_stream(out), "muggle-test")

    def test_read_of_skill_md_routes_via_path(self):
        out = assistant_event("Read", {"file_path": "C:\\repo\\plugin\\skills\\muggle-status\\SKILL.md"})
        self.assertEqual(router_eval.parse_route_from_stream(out), "muggle-status")

    def test_other_tool_call_is_none(self):
        out = assistant_event("Bash", {"command": "ls"})
        self.assertEqual(router_eval.parse_route_from_stream(out), router_eval.NONE)

    def test_result_without_tool_call_is_none(self):
        out = json.dumps({"type": "result", "result": "answered directly"})
        self.assertEqual(router_eval.parse_route_from_stream(out), router_eval.NONE)

    def test_garbage_lines_are_skipped(self):
        out = "not json\n" + assistant_event("Skill", {"skill": "muggle-do"})
        self.assertEqual(router_eval.parse_route_from_stream(out), "muggle-do")


class TestStreamErrorText(unittest.TestCase):
    def test_error_result_is_surfaced(self):
        line = json.dumps({"type": "result", "is_error": True, "result": "rate limit reached"})
        self.assertEqual(router_eval.stream_error_text(line), line)

    def test_normal_result_is_not_an_error(self):
        out = json.dumps({"type": "result", "result": "fine"})
        self.assertEqual(router_eval.stream_error_text(out), "")


if __name__ == "__main__":
    unittest.main()
