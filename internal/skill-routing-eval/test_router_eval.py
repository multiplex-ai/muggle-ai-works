import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock

import router_eval
from route_constants import REPORT_NONE_REASONS_FIELD
from route_types import NoneReason
from scoring import scored_pass

SKILL_FIXTURE_TEMPLATE = '''---
name: {name}
description: {description}
---

# {name}
'''


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


class TestRealRouteOutranksToolSignal(unittest.TestCase):
    def test_muggle_toolsearch_before_the_skill_scores_the_skill(self):
        out = session(
            assistant_event("ToolSearch", {"query": "select:muggle-remote-project-list"}),
            assistant_event("Skill", {"skill": "muggle:muggle-test"}),
        )
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-test")

    def test_muggle_mcp_tool_before_the_skill_scores_the_skill(self):
        out = session(
            assistant_event("mcp__plugin_muggle_muggle__muggle-remote-project-list", {}),
            assistant_event("Skill", {"skill": "muggle-do"}),
        )
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-do")

    def test_muggle_toolsearch_before_a_skill_md_read_scores_the_skill(self):
        out = session(
            assistant_event("ToolSearch", {"query": "select:muggle-remote-project-list"}),
            assistant_event("Read", {"file_path": "C:\repo\plugin\skills\muggle-status\SKILL.md"}),
        )
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-status")

    def test_tool_signal_and_skill_in_one_turn_score_the_skill(self):
        out = json.dumps({
            "type": "assistant",
            "message": {"content": [
                {"type": "tool_use", "name": "ToolSearch", "input": {"query": "muggle"}},
                {"type": "tool_use", "name": "Skill", "input": {"skill": "muggle-test"}},
            ]},
        })
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-test")

    def test_muggle_toolsearch_with_no_skill_anywhere_still_falls_back(self):
        out = session(
            assistant_event("ToolSearch", {"query": "select:muggle-remote-project-list"}),
            assistant_event("Bash", {"command": "ls"}),
            json.dumps({"type": "result", "result": "answered directly"}),
        )
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-tools")

    def test_muggle_mcp_tool_with_no_skill_anywhere_still_falls_back(self):
        out = session(
            assistant_event("mcp__plugin_muggle_muggle__muggle-remote-project-list", {}),
            assistant_event("Bash", {"command": "ls"}),
        )
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-mcp-tool")

    def test_first_of_two_skill_invocations_wins(self):
        out = session(
            assistant_event("Skill", {"skill": "muggle-test"}),
            assistant_event("Skill", {"skill": "muggle-do"}),
        )
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-test")

    def test_a_skill_md_read_beats_a_later_skill_invocation(self):
        out = session(
            assistant_event("Read", {"file_path": "C:\repo\plugin\skills\muggle-status\SKILL.md"}),
            assistant_event("Skill", {"skill": "muggle-test"}),
        )
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-status")

    def test_first_tool_signal_wins_when_the_session_never_routes(self):
        out = session(
            assistant_event("ToolSearch", {"query": "select:muggle-remote-project-list"}),
            assistant_event("mcp__plugin_muggle_muggle__muggle-remote-project-list", {}),
        )
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-tools")

    def test_session_touching_nothing_muggle_is_none(self):
        out = session(
            assistant_event("ToolSearch", {"query": "notebook jupyter"}),
            assistant_event("Bash", {"command": "ls"}),
        )
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

    def test_a_skill_after_a_tool_signal_passes_its_positive_query(self):
        out = session(
            assistant_event("ToolSearch", {"query": "select:muggle-remote-project-list"}),
            assistant_event("Skill", {"skill": "muggle-test"}),
        )
        self.assertTrue(scored_pass("muggle-test", router_eval.parse_route_from_session(out)))

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

    def test_a_miss_names_why_nothing_routed(self):
        line = router_eval.format_run_progress(
            1, 3, "q", "none", "muggle-test", NoneReason.ORIENTED_ONLY
        )
        self.assertIn("MISS", line)
        self.assertIn("route=none (oriented_only)", line)

    def test_a_routed_run_carries_no_reason(self):
        line = router_eval.format_run_progress(1, 3, "q", "muggle-test", "muggle-test")
        self.assertIn("route=muggle-test ::", line)
        for reason in NoneReason:
            self.assertNotIn(reason.value, line)


class TestAliasRoutesResolveToCanonical(unittest.TestCase):
    def test_alias_skill_invocation_scores_the_canonical_skill(self):
        out = assistant_event("Skill", {"skill": "muggle:mfeedback"})
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-feedback")

    def test_bare_alias_name_scores_the_canonical_skill(self):
        out = assistant_event("Skill", {"skill": "mupgrade"})
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-upgrade")

    def test_canonical_skill_invocation_passes_through(self):
        out = assistant_event("Skill", {"skill": "muggle:muggle-test"})
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-test")

    def test_non_muggle_skill_passes_through(self):
        out = assistant_event("Skill", {"skill": "superpowers:brainstorming"})
        self.assertEqual(router_eval.parse_route_from_session(out), "brainstorming")

    def test_a_name_that_is_no_alias_passes_through(self):
        self.assertEqual(router_eval.resolve_alias_route("mnevershipped"), "mnevershipped")
        self.assertEqual(router_eval.resolve_alias_route(""), "")

    def test_read_of_an_alias_skill_md_scores_the_canonical_skill(self):
        out = assistant_event("Read", {"file_path": "/repo/plugin/skills/mtestlocal/SKILL.md"})
        self.assertEqual(router_eval.parse_route_from_session(out), "muggle-test-feature-local")

    def test_alias_after_orienting_still_scores_the_canonical_skill(self):
        out = session(
            assistant_event("Bash", {"command": "git status"}),
            assistant_event("Skill", {"skill": "muggle:mregen"}),
        )
        self.assertEqual(
            router_eval.parse_route_from_session(out), "muggle-test-regenerate-missing"
        )

    def test_every_shipped_alias_targets_a_canonical_muggle_skill(self):
        self.assertTrue(router_eval.ALIAS_TO_CANONICAL)
        for alias, canonical in router_eval.ALIAS_TO_CANONICAL.items():
            self.assertTrue(canonical.startswith("muggle"), alias)
            self.assertNotIn(canonical, router_eval.ALIAS_TO_CANONICAL)


class TestAliasRoutesAgainstScoring(unittest.TestCase):
    def test_alias_route_passes_its_canonical_positive_query(self):
        out = assistant_event("Skill", {"skill": "muggle:mfeedback"})
        self.assertTrue(scored_pass("muggle-feedback", router_eval.parse_route_from_session(out)))

    def test_alias_route_fails_the_negative_class(self):
        out = assistant_event("Skill", {"skill": "muggle:mfeedback"})
        route = router_eval.parse_route_from_session(out)
        self.assertFalse(scored_pass(router_eval.NONE, route))

    def test_alias_route_is_marked_a_miss_on_a_negative_query(self):
        out = assistant_event("Skill", {"skill": "muggle:mtest"})
        route = router_eval.parse_route_from_session(out)
        self.assertIn("MISS", router_eval.format_run_progress(1, 3, "q", route, router_eval.NONE))


class TestBuildAliasToCanonical(unittest.TestCase):
    def _write_skill(self, skills_dir, name, description):
        skill_dir = skills_dir / name
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            SKILL_FIXTURE_TEMPLATE.format(name=name, description=description),
            encoding="utf-8",
        )

    def test_map_is_derived_from_frontmatter_declarations(self):
        with tempfile.TemporaryDirectory() as tmp:
            skills_dir = Path(tmp)
            self._write_skill(
                skills_dir,
                "xshort",
                "Explicit short alias for the `example-canonical` skill. ONLY invoke when"
                " the user explicitly types `xshort`.",
            )
            self._write_skill(
                skills_dir, "example-canonical", "Does the real work and delegates to nothing."
            )
            self.assertEqual(
                router_eval.build_alias_to_canonical(skills_dir),
                {"xshort": "example-canonical"},
            )

    def test_declaration_outside_the_description_is_not_an_alias(self):
        with tempfile.TemporaryDirectory() as tmp:
            skills_dir = Path(tmp)
            self._write_skill(skills_dir, "example-canonical", "Does the real work.")
            body = skills_dir / "example-canonical" / "SKILL.md"
            body.write_text(
                body.read_text(encoding="utf-8")
                + "Users may reach this via an alias for the `example-canonical` skill.",
                encoding="utf-8",
            )
            self.assertEqual(router_eval.build_alias_to_canonical(skills_dir), {})

    def test_missing_skills_dir_yields_an_empty_map(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(router_eval.build_alias_to_canonical(Path(tmp) / "absent"), {})


class TestClassifyNoneReason(unittest.TestCase):
    def test_an_answer_with_no_tool_call_is_the_no_tool_reason(self):
        out = json.dumps({"type": "result", "result": "here is what muggle can do"})
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.NO_TOOL_CALL)

    def test_an_empty_stream_is_the_no_tool_reason(self):
        self.assertEqual(router_eval.classify_none_reason(""), NoneReason.NO_TOOL_CALL)

    def test_orienting_shell_calls_are_the_oriented_reason(self):
        out = session(
            assistant_event("Bash", {"command": "git status && git diff"}),
            assistant_event("Bash", {"command": "ls"}),
        )
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.ORIENTED_ONLY)

    def test_powershell_orienting_is_the_oriented_reason(self):
        out = assistant_event("PowerShell", {"command": "git status; Get-ChildItem"})
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.ORIENTED_ONLY)

    def test_hunting_for_a_tool_is_the_oriented_reason(self):
        out = session(
            assistant_event("ToolSearch", {"query": "booking reservation"}),
            assistant_event("ToolSearch", {"query": "restaurant table"}),
        )
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.ORIENTED_ONLY)

    def test_reading_and_searching_is_the_oriented_reason(self):
        out = session(
            assistant_event("Grep", {"pattern": "login"}),
            assistant_event("Read", {"file_path": "C:\\repo\\src\\index.ts"}),
        )
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.ORIENTED_ONLY)

    def test_doing_the_task_by_hand_is_the_worked_reason(self):
        out = session(
            assistant_event("Bash", {"command": "npm install"}),
            assistant_event("Read", {"file_path": "C:\\repo\\src\\index.ts"}),
            assistant_event("Bash", {"command": "npx playwright test"}),
        )
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.WORKED_BY_HAND)

    def test_writing_a_file_after_orienting_is_the_worked_reason(self):
        out = session(
            assistant_event("Bash", {"command": "git status"}),
            assistant_event("Write", {"file_path": "checkout.spec.ts"}),
        )
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.WORKED_BY_HAND)

    def test_one_acting_segment_makes_the_whole_command_work(self):
        out = assistant_event("Bash", {"command": "git status && npm install"})
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.WORKED_BY_HAND)

    def test_a_redirect_writes_whatever_the_verb_reads(self):
        out = assistant_event("Bash", {"command": "cat template.md > spec.md"})
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.WORKED_BY_HAND)

    def test_an_unrecognized_command_counts_as_work(self):
        out = assistant_event("Bash", {"command": "./scripts/seed-database.sh"})
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.WORKED_BY_HAND)

    def test_a_shell_call_carrying_no_command_counts_as_work(self):
        out = assistant_event("Bash", {})
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.WORKED_BY_HAND)

    def test_a_chained_diff_survey_is_the_oriented_reason(self):
        out = assistant_event(
            "Bash", {"command": 'cd /x && git diff --stat && echo "---" && git diff'}
        )
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.ORIENTED_ONLY)

    def test_a_semicolon_separated_survey_is_the_oriented_reason(self):
        out = assistant_event("Bash", {"command": 'git remote -v; echo "x"; ls -a'})
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.ORIENTED_ONLY)

    def test_probing_for_a_cli_with_powershell_is_the_oriented_reason(self):
        out = assistant_event("PowerShell", {"command": (
            '(Get-Command aws -ErrorAction SilentlyContinue).Source;'
            ' Test-Path "$env:USERPROFILE\\.aws\\config"'
        )})
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.ORIENTED_ONLY)

    def test_a_piped_cmdlet_is_the_oriented_reason(self):
        out = assistant_event(
            "PowerShell", {"command": "Get-ChildItem | Select-Object -First 5"}
        )
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.ORIENTED_ONLY)

    def test_a_discarded_stream_is_not_a_write(self):
        out = assistant_event(
            "Bash", {"command": 'ls -a .github/workflows 2>/dev/null; cat netlify.toml 2>&1'}
        )
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.ORIENTED_ONLY)

    def test_a_destructive_segment_in_a_read_only_chain_counts_as_work(self):
        out = assistant_event("Bash", {"command": "git status && rm -rf build"})
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.WORKED_BY_HAND)

    def test_a_checkout_in_a_read_only_chain_counts_as_work(self):
        out = assistant_event("PowerShell", {"command": "git status; git checkout -b fix"})
        self.assertEqual(router_eval.classify_none_reason(out), NoneReason.WORKED_BY_HAND)


class TestNoneReasonLeavesScoringAlone(unittest.TestCase):
    SESSIONS_BY_REASON = {
        NoneReason.NO_TOOL_CALL: json.dumps({"type": "result", "result": "answered directly"}),
        NoneReason.ORIENTED_ONLY: assistant_event("Bash", {"command": "git status"}),
        NoneReason.WORKED_BY_HAND: assistant_event("Bash", {"command": "npm install"}),
    }

    def test_every_reason_still_parses_as_the_literal_none_route(self):
        for reason, out in self.SESSIONS_BY_REASON.items():
            self.assertEqual(router_eval.parse_route_from_session(out), "none", reason)
            self.assertEqual(router_eval.classify_none_reason(out), reason)

    def test_the_negative_class_still_passes_whatever_the_reason(self):
        for reason, out in self.SESSIONS_BY_REASON.items():
            route = router_eval.parse_route_from_session(out)
            self.assertTrue(scored_pass(router_eval.NONE, route), reason)

    def test_a_positive_query_still_misses_whatever_the_reason(self):
        for reason, out in self.SESSIONS_BY_REASON.items():
            route = router_eval.parse_route_from_session(out)
            self.assertFalse(scored_pass("muggle-test", route), reason)

    def test_the_reason_never_leaks_into_the_scored_route(self):
        for reason, out in self.SESSIONS_BY_REASON.items():
            self.assertNotIn(reason.value, router_eval.parse_route_from_session(out))


class TestDetectRouteOutcome(unittest.TestCase):
    def _detect_from_stream(self, stdout: str):
        finished = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=stdout.encode("utf-8"), stderr=b"",
        )
        with mock.patch("subprocess.run", return_value=finished):
            return router_eval.detect_route("q", ".", 10, None)

    def test_a_session_with_no_tool_call_scores_none_and_names_the_reason(self):
        outcome = self._detect_from_stream(json.dumps({"type": "result", "result": "answered directly"}))
        self.assertEqual(outcome.route, "none")
        self.assertEqual(outcome.none_reason, NoneReason.NO_TOOL_CALL)
        self.assertTrue(scored_pass(router_eval.NONE, outcome.route))

    def test_a_session_that_only_oriented_scores_none_and_names_the_reason(self):
        outcome = self._detect_from_stream(session(
            assistant_event("Bash", {"command": "git status"}),
            assistant_event("Bash", {"command": "git diff"}),
        ))
        self.assertEqual(outcome.route, "none")
        self.assertEqual(outcome.none_reason, NoneReason.ORIENTED_ONLY)
        self.assertFalse(scored_pass("muggle-browser-task", outcome.route))

    def test_a_routed_session_carries_no_reason(self):
        outcome = self._detect_from_stream(assistant_event("Skill", {"skill": "muggle:muggle-test"}))
        self.assertEqual(outcome.route, "muggle-test")
        self.assertIsNone(outcome.none_reason)

    def test_a_timed_out_session_carries_no_reason(self):
        expired = subprocess.TimeoutExpired(cmd="claude", timeout=1)
        with mock.patch("subprocess.run", side_effect=expired):
            outcome = router_eval.detect_route("q", ".", 1, None)
        self.assertEqual(outcome.route, "TIMEOUT")
        self.assertIsNone(outcome.none_reason)


class TestReportCarriesNoneReasons(unittest.TestCase):
    def _report_for(self, eval_set: list[dict], outcomes_by_query: dict) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            eval_set_path = Path(tmp) / "eval-set.json"
            eval_set_path.write_text(json.dumps(eval_set), encoding="utf-8")
            report_path = Path(tmp) / "report.json"
            scripted = {q: iter(outcomes) for q, outcomes in outcomes_by_query.items()}

            def scripted_detect(query, repo_root, timeout, model):
                return next(scripted[query])

            argv = [
                "router_eval.py",
                "--eval-set", str(eval_set_path),
                "--out", str(report_path),
                "--runs", "3",
                "--workers", "1",
            ]
            with mock.patch.object(router_eval, "detect_route", scripted_detect), \
                    mock.patch.object(sys, "argv", argv), redirect_stderr(io.StringIO()):
                router_eval.main()
            return json.loads(report_path.read_text(encoding="utf-8"))

    def test_reasons_are_aggregated_across_a_query_runs(self):
        report = self._report_for(
            [{"query": "book me a table", "expected_skill": "muggle-browser-task"}],
            {"book me a table": [
                router_eval.RouteOutcome("none", NoneReason.NO_TOOL_CALL),
                router_eval.RouteOutcome("none", NoneReason.ORIENTED_ONLY),
                router_eval.RouteOutcome("none", NoneReason.ORIENTED_ONLY),
            ]},
        )
        entry = report["results"][0]
        self.assertEqual(entry[REPORT_NONE_REASONS_FIELD], {"no_tool_call": 1, "oriented_only": 2})
        self.assertEqual(entry["fired"], ["none", "none", "none"])
        self.assertEqual(entry["majority"], "none")
        self.assertFalse(entry["pass"])

    def test_a_query_that_routed_carries_no_reasons(self):
        report = self._report_for(
            [{"query": "test my changes", "expected_skill": "muggle-test"}],
            {"test my changes": [router_eval.RouteOutcome("muggle-test", None)] * 3},
        )
        entry = report["results"][0]
        self.assertEqual(entry[REPORT_NONE_REASONS_FIELD], {})
        self.assertTrue(entry["pass"])

    def test_a_negative_query_that_never_routed_still_passes(self):
        report = self._report_for(
            [{"query": "what can muggle do", "expected_skill": "none"}],
            {"what can muggle do": [router_eval.RouteOutcome("none", NoneReason.NO_TOOL_CALL)] * 3},
        )
        entry = report["results"][0]
        self.assertEqual(entry["majority"], "none")
        self.assertTrue(entry["pass"])
        self.assertEqual(entry[REPORT_NONE_REASONS_FIELD], {"no_tool_call": 3})


if __name__ == "__main__":
    unittest.main()
