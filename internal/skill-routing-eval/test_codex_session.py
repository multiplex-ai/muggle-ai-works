import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock

import codex_session
import router_eval
from codex_constants import ROUTE_TRACE_ENV, ROUTE_TRACER_HOOK, SESSION_MAX_TOOL_CALLS
from route_types import Host, NoneReason, RouteOutcome

# Lines a real `codex exec --json` session printed against a scripted model,
# followed by the lines the route tracer appended for it; long outputs trimmed.
CODEX_PREAMBLE = [
    '{"type":"thread.started","thread_id":"01a15bc3-04f6-7422-b71e-265d3d2aa0ee"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"`--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation."}}',
    '{"type":"turn.started"}',
]
SKILL_PATH = "/tmp/codex-live-home-iVa42z/plugins/cache/muggle-works/muggle/5.18.0/skills/muggle-test/SKILL.md"
ROUTED_SESSION = "\n".join([
    *CODEX_PREAMBLE,
    '{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"/bin/bash -c \'git status --short\'","aggregated_output":"fatal: not a git repository\\n","exit_code":128,"status":"failed"}}',
    '{"type":"item.started","item":{"id":"item_3","type":"command_execution","command":"/bin/bash -c \\"sed -n \'1,200p\' \'' + SKILL_PATH + '\'\\"","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
    "",
    '{"type":"muggle.route_trace","tool_name":"Bash","tool_input":{"command":"git status --short"}}',
    '{"type":"muggle.route_trace","tool_name":"Bash","tool_input":{"command":"sed -n \'1,200p\' \'' + SKILL_PATH + '\'"}}',
])
ANSWERED_SESSION = "\n".join([
    *CODEX_PREAMBLE,
    '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Muggle cannot help with that."}}',
    '{"type":"turn.completed","usage":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0}}',
    "",
])
MCP_SESSION = "\n".join([
    *CODEX_PREAMBLE,
    '{"type":"item.completed","item":{"id":"item_2","type":"mcp_tool_call","server":"muggle","tool":"muggle-local-check-status","arguments":{},"status":"completed"}}',
    "",
    '{"type":"muggle.route_trace","tool_name":"mcp__muggle__muggle_local_check_status","tool_input":{}}',
])
THROTTLED_SESSION = "\n".join([
    *CODEX_PREAMBLE,
    '{"type":"error","message":"rate limit exceeded: Rate limit reached for mock-model on tokens per min (TPM): Limit 30000, Used 30000. Please try again in 2s."}',
    '{"type":"turn.failed","error":{"message":"rate limit exceeded: Rate limit reached for mock-model on tokens per min (TPM): Limit 30000, Used 30000. Please try again in 2s."}}',
])
# A Claude stream-json session that routed, for keeping the two readers apart.
CLAUDE_ROUTED_SESSION = json.dumps({
    "type": "assistant",
    "message": {"content": [{"type": "tool_use", "name": "Skill", "input": {"skill": "muggle:muggle-test"}}]},
})

NODE = shutil.which("node")

# Stands in for `codex exec`: prints the JSONL of FAKE_CODEX_SCENARIO, appends
# the tool calls it "makes" to the trace the way the tracer hook does, and
# records its argv. A scenario that routes then hangs, as a real session keeps
# going after the route — so only the harness ending it lets the test finish.
FAKE_CODEX = r"""
import { appendFileSync, writeFileSync } from "node:fs";
writeFileSync(process.env.FAKE_CODEX_ARGV, JSON.stringify(process.argv.slice(2)));
const trace = (tool_name, tool_input) =>
  appendFileSync(process.env.MUGGLE_ROUTE_TRACE, JSON.stringify({ type: "muggle.route_trace", tool_name, tool_input }) + "\n");
const say = (event) => process.stdout.write(JSON.stringify(event) + "\n");
const hang = () => setInterval(() => {}, 1000);
say({ type: "thread.started", thread_id: "t" });
say({ type: "turn.started" });
switch (process.env.FAKE_CODEX_SCENARIO) {
  case "routes":
    trace("Bash", { command: "git status --short" });
    trace("Bash", { command: "cat /x/skills/muggle-test/SKILL.md" });
    hang();
    break;
  case "looks-forever":
    setInterval(() => trace("Bash", { command: "git status --short" }), 20);
    break;
  case "answers":
    say({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "Nothing to test here." } });
    say({ type: "turn.completed", usage: {} });
    break;
  case "rate-limited":
    say({ type: "error", message: "rate limit exceeded: Rate limit reached. Please try again in 2s." });
    say({ type: "turn.failed", error: { message: "rate limit exceeded: Rate limit reached. Please try again in 2s." } });
    process.exitCode = 1;
    break;
  case "breaks":
    say({ type: "turn.failed", error: { message: "unexpected status 401 Unauthorized" } });
    process.exitCode = 1;
    break;
  case "retries-then-answers":
    say({ type: "error", message: "stream disconnected before completion; retrying 1/5" });
    say({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "Answered." } });
    say({ type: "turn.completed", usage: {} });
    break;
  default:
    hang();
}
"""


class TestCodexToolCalls(unittest.TestCase):
    def test_only_traced_calls_are_read_and_in_order(self):
        calls = list(codex_session.iter_tool_calls(ROUTED_SESSION))
        self.assertEqual(
            calls,
            [
                ("Bash", {"command": "git status --short"}),
                ("Bash", {"command": f"sed -n '1,200p' '{SKILL_PATH}'"}),
            ],
        )

    def test_input_that_was_not_json_reads_as_empty(self):
        line = json.dumps({"type": "muggle.route_trace", "tool_name": "custom", "tool_input": "raw text"})
        self.assertEqual(list(codex_session.iter_tool_calls(line)), [("custom", {})])

    def test_a_claude_stream_has_no_codex_calls(self):
        self.assertEqual(list(codex_session.iter_tool_calls(CLAUDE_ROUTED_SESSION)), [])


class TestSkillOpenedBy(unittest.TestCase):
    def test_a_shell_read_names_the_skill(self):
        self.assertEqual(codex_session.skill_opened_by({"command": f"sed -n '1,200p' '{SKILL_PATH}'"}), "muggle-test")

    def test_a_windows_path_names_the_skill(self):
        command = r"Get-Content -TotalCount 200 -LiteralPath 'C:\Users\a\.codex\plugins\cache\muggle-works\muggle\5.18.0\skills\muggle-do\SKILL.md'"
        self.assertEqual(codex_session.skill_opened_by({"command": command}), "muggle-do")

    def test_a_file_tool_path_names_the_skill(self):
        self.assertEqual(codex_session.skill_opened_by({"path": "/x/skills/muggle-status/SKILL.md"}), "muggle-status")

    def test_a_short_catalog_path_names_the_skill(self):
        self.assertEqual(codex_session.skill_opened_by({"command": "cat r1/muggle-test/SKILL.md"}), "muggle-test")

    def test_searching_every_skill_opens_none(self):
        for command in ("rg -n description skills/*/SKILL.md", "find . -name SKILL.md", "ls skills/muggle-test"):
            self.assertEqual(codex_session.skill_opened_by({"command": command}), "", command)


class TestSessionHasEnded(unittest.TestCase):
    @staticmethod
    def _looks(count: int) -> str:
        line = json.dumps({"type": "muggle.route_trace", "tool_name": "Bash", "tool_input": {"command": "ls"}})
        return "\n".join([line] * count)

    def test_a_skill_read_ends_it(self):
        self.assertTrue(codex_session.session_has_ended(ROUTED_SESSION))

    def test_looking_ends_it_only_at_the_cap(self):
        self.assertFalse(codex_session.session_has_ended(self._looks(SESSION_MAX_TOOL_CALLS - 1)))
        self.assertTrue(codex_session.session_has_ended(self._looks(SESSION_MAX_TOOL_CALLS)))

    def test_an_mcp_call_alone_does_not_end_it(self):
        self.assertFalse(codex_session.session_has_ended(MCP_SESSION))


class TestCodexStreamText(unittest.TestCase):
    def test_the_answer_is_the_last_agent_message(self):
        self.assertEqual(codex_session.last_agent_message(ANSWERED_SESSION), "Muggle cannot help with that.")
        self.assertEqual(codex_session.last_agent_message(ROUTED_SESSION), "")

    def test_a_failed_turn_names_its_cause(self):
        self.assertIn("Rate limit reached", codex_session.turn_failure_text(THROTTLED_SESSION))

    def test_an_error_item_is_not_a_failed_turn(self):
        # Codex reports the hook-trust bypass as an error item on every session.
        self.assertEqual(codex_session.turn_failure_text(ROUTED_SESSION), "")
        self.assertEqual(codex_session.reported_error_texts(ROUTED_SESSION), [])


class TestCodexRoutes(unittest.TestCase):
    def test_a_skill_read_is_the_route(self):
        self.assertEqual(router_eval.parse_route_from_session(ROUTED_SESSION, Host.CODEX), "muggle-test")

    def test_an_alias_read_scores_as_its_canonical_skill(self):
        alias, canonical = next(iter(router_eval.ALIAS_TO_CANONICAL.items()))
        line = json.dumps({
            "type": "muggle.route_trace",
            "tool_name": "Bash",
            "tool_input": {"command": f"cat /x/skills/{alias}/SKILL.md"},
        })
        self.assertEqual(router_eval.parse_route_from_session(line, Host.CODEX), canonical)

    def test_a_muggle_mcp_call_stands_in_when_no_skill_was_read(self):
        self.assertEqual(router_eval.parse_route_from_session(MCP_SESSION, Host.CODEX), "muggle-mcp-tool")

    def test_each_host_reads_only_its_own_stream(self):
        self.assertEqual(router_eval.parse_route_from_session(ROUTED_SESSION, Host.CLAUDE), router_eval.NONE)
        self.assertEqual(router_eval.parse_route_from_session(CLAUDE_ROUTED_SESSION, Host.CODEX), router_eval.NONE)

    def test_why_a_codex_session_never_routed(self):
        def traced(*calls):
            return "\n".join(
                json.dumps({"type": "muggle.route_trace", "tool_name": name, "tool_input": tool_input})
                for name, tool_input in calls
            )

        oriented = traced(
            ("Bash", {"command": "git status --short"}),
            ("Bash", {"command": "nl -ba src/checkout.js | sed -n '1,120p'"}),
            ("view_image", {"path": "shot.png"}),
        )
        acted = traced(("Bash", {"command": "git status"}), ("apply_patch", {"command": "*** Begin Patch"}))
        self.assertEqual(router_eval.classify_none_reason(ANSWERED_SESSION, Host.CODEX), NoneReason.NO_TOOL_CALL)
        self.assertEqual(router_eval.classify_none_reason(oriented, Host.CODEX), NoneReason.ORIENTED_ONLY)
        self.assertEqual(router_eval.classify_none_reason(acted, Host.CODEX), NoneReason.ACTED_WITHOUT_ROUTING)

    def test_detect_route_runs_the_codex_session_and_reads_it_as_codex(self):
        with mock.patch.object(codex_session, "run_codex_once", return_value=("OK", ANSWERED_SESSION)) as run, \
                mock.patch.object(router_eval, "run_claude_once") as claude:
            outcome = router_eval.detect_route("q", ".", 10, None, host=Host.CODEX)
        run.assert_called_once_with("q", ".", 10, None)
        claude.assert_not_called()
        self.assertEqual(outcome, RouteOutcome("none", NoneReason.NO_TOOL_CALL, "Muggle cannot help with that."))

    def test_the_report_names_its_host(self):
        with tempfile.TemporaryDirectory() as tmp:
            eval_set = Path(tmp) / "eval-set.json"
            eval_set.write_text(json.dumps([{"query": "q", "expected_skill": "muggle-test"}]), encoding="utf-8")
            report = Path(tmp) / "report.json"
            argv = ["router_eval.py", "--eval-set", str(eval_set), "--out", str(report), "--runs", "1", "--host", "codex"]
            hosts = []

            def scripted_detect(query, repo_root, timeout, model, host=Host.CLAUDE, claude_config_dir=None):
                hosts.append(host)
                return RouteOutcome("muggle-test", None)

            with mock.patch.object(router_eval, "detect_route", scripted_detect), \
                    mock.patch.object(sys, "argv", argv), redirect_stderr(io.StringIO()):
                router_eval.main()
            self.assertEqual(json.loads(report.read_text(encoding="utf-8"))["host"], "codex")
            self.assertEqual(hosts, [Host.CODEX])


@unittest.skipUnless(NODE, "node is needed to stand in for Codex")
class TestRunCodexOnce(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        fake = self.tmp / "fake-codex.mjs"
        fake.write_text(FAKE_CODEX, encoding="utf-8")
        self.argv_file = self.tmp / "argv.json"
        self._env = mock.patch.dict(os.environ, {"CODEX_BIN": str(fake), "FAKE_CODEX_ARGV": str(self.argv_file)})
        self._env.start()

    def tearDown(self):
        self._env.stop()
        self._tmp.cleanup()

    def _run(self, scenario: str, timeout: int = 30, model: str | None = None):
        with mock.patch.dict(os.environ, {"FAKE_CODEX_SCENARIO": scenario}), redirect_stderr(io.StringIO()) as err:
            started = time.monotonic()
            status, stream = codex_session.run_codex_once("test my changes", str(self.tmp), timeout, model)
            self.elapsed = time.monotonic() - started
        self.stderr = err.getvalue()
        return status, stream

    def test_the_session_is_ended_at_its_route(self):
        status, stream = self._run("routes")
        self.assertEqual(status, "OK")
        self.assertLess(self.elapsed, 20)
        self.assertEqual(router_eval.parse_route_from_session(stream, Host.CODEX), "muggle-test")

    def test_a_session_that_never_routes_is_ended_at_the_cap(self):
        status, stream = self._run("looks-forever")
        self.assertEqual(status, "OK")
        self.assertGreaterEqual(len(list(codex_session.iter_tool_calls(stream))), SESSION_MAX_TOOL_CALLS)
        self.assertEqual(router_eval.classify_none_reason(stream, Host.CODEX), NoneReason.ORIENTED_ONLY)

    def test_a_session_that_answers_runs_to_its_end(self):
        status, stream = self._run("answers")
        self.assertEqual(status, "OK")
        self.assertEqual(codex_session.last_agent_message(stream), "Nothing to test here.")

    def test_an_error_codex_retried_past_is_not_a_failure(self):
        status, stream = self._run("retries-then-answers")
        self.assertEqual(status, "OK")
        self.assertEqual(codex_session.last_agent_message(stream), "Answered.")

    def test_a_rate_limited_turn_is_throttled(self):
        self.assertEqual(self._run("rate-limited"), ("THROTTLED", ""))

    def test_any_other_failed_turn_is_an_error_that_says_why(self):
        self.assertEqual(self._run("breaks"), ("ERROR", ""))
        self.assertIn("401 Unauthorized", self.stderr)

    def test_a_session_past_its_deadline_times_out(self):
        self.assertEqual(self._run("hangs", timeout=1), ("TIMEOUT", ""))

    def test_the_session_runs_headless_with_hooks_trusted_and_the_sandbox_on(self):
        self._run("answers", model="gpt-test")
        argv = json.loads(self.argv_file.read_text(encoding="utf-8"))
        self.assertEqual(argv[0], "exec")
        for flag in ("--json", "--ephemeral", "--skip-git-repo-check", "--dangerously-bypass-hook-trust"):
            self.assertIn(flag, argv)
        self.assertEqual(argv[argv.index("--sandbox") + 1], "read-only")
        self.assertEqual(argv[argv.index("--model") + 1], "gpt-test")
        self.assertEqual(argv[-1], "test my changes")


@unittest.skipUnless(NODE, "node runs the tracer hook")
class TestRouteTracer(unittest.TestCase):
    def _hook(self, stdin: str, trace: Path | None) -> subprocess.CompletedProcess:
        env = {k: v for k, v in os.environ.items() if k != ROUTE_TRACE_ENV}
        if trace:
            env[ROUTE_TRACE_ENV] = str(trace)
        return subprocess.run([NODE, str(ROUTE_TRACER_HOOK)], input=stdin, capture_output=True, text=True, env=env)

    def test_it_appends_the_call_and_lets_it_through(self):
        with tempfile.TemporaryDirectory() as tmp:
            trace = Path(tmp) / "trace.jsonl"
            payload = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "ls"}}
            for _ in range(2):
                run = self._hook(json.dumps(payload), trace)
                self.assertEqual((run.returncode, run.stdout), (0, "{}"))
            self.assertEqual(
                list(codex_session.iter_tool_calls(trace.read_text(encoding="utf-8"))),
                [("Bash", {"command": "ls"})] * 2,
            )

    def test_it_never_blocks_a_call_it_cannot_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            trace = Path(tmp) / "trace.jsonl"
            self.assertEqual(self._hook("not json", trace).stdout, "{}")
            self.assertFalse(trace.exists())
        self.assertEqual(self._hook(json.dumps({"tool_name": "Bash"}), None).stdout, "{}")

    def test_it_is_installed_for_every_tool(self):
        with tempfile.TemporaryDirectory() as tmp:
            hooks = json.loads(codex_session.install_route_tracer(Path(tmp)).read_text(encoding="utf-8"))
        (group,) = hooks["hooks"]["PreToolUse"]
        self.assertNotIn("matcher", group)
        self.assertIn(str(ROUTE_TRACER_HOOK), group["hooks"][0]["command"])


if __name__ == "__main__":
    unittest.main()
