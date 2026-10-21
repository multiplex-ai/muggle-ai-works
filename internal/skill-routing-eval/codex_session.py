#!/usr/bin/env python3
"""Routing-eval sessions under Codex.

The Claude harness reads routes off `claude -p --output-format stream-json`.
Codex reports a tool call in `codex exec --json` only when the model makes it
directly — one nested in its code mode is missing there — so the route comes
from a PreToolUse hook instead (codex_route_tracer.mjs), installed in the
CODEX_HOME the eval runs under. Its lines and Codex's own JSONL share one
stream: tracer lines carry `type: muggle.route_trace`.

    python internal/skill-routing-eval/codex_session.py prepare --codex-home DIR

installs the plugin from this checkout into DIR and adds the tracer. Point
CODEX_HOME at DIR and authenticate it (CODEX_API_KEY, or `codex login`), then
run the eval with `--host codex`. Re-running it refreshes Codex's copy of the
plugin from the working tree.
"""

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import throttle
from codex_constants import (
    CODEX_EXEC_FLAGS,
    CODEX_PLUGIN_ID,
    DEFAULT_CODEX_SANDBOX,
    ROUTE_TRACE_ENV,
    ROUTE_TRACE_EVENT_TYPE,
    ROUTE_TRACER_HOOK,
    SANDBOX_ENV,
    SESSION_MAX_TOOL_CALLS,
    TRACE_POLL_SECONDS,
)

# Codex has no skill tool: the model opens a skill by reading its SKILL.md,
# through the shell or a file tool, and the directory before it is the skill.
# Glob characters are left out, so `rg x skills/*/SKILL.md` opens none.
SKILL_FILE_PATTERN = re.compile(r"([A-Za-z0-9._:-]+)[\\/]SKILL\.md")

# Where a hook payload carries the path a call reads: a shell command, or a file tool's argument.
PATH_BEARING_INPUT_KEYS = ("command", "file_path", "path")

CHECKOUT_ROOT = Path(__file__).resolve().parents[2]


def _json_lines(stream: str):
    for line in stream.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue


def iter_tool_calls(stream: str):
    """Yields `(tool_name, tool_input)` for every traced call, in the order Codex made them.

    A tool whose arguments were not JSON reaches the hook as a bare string; it
    carries no path or command to read, so it comes through as `{}`.
    """
    for event in _json_lines(stream):
        if event.get("type") != ROUTE_TRACE_EVENT_TYPE:
            continue
        tool_input = event.get("tool_input")
        yield event.get("tool_name", ""), tool_input if isinstance(tool_input, dict) else {}


def skill_opened_by(tool_input: dict) -> str:
    """The skill whose SKILL.md a call reads, or "" when it reads none.

    Output shape: `{"command": "sed -n '1,200p' /x/skills/muggle-test/SKILL.md"}` -> `"muggle-test"`
    """
    for key in PATH_BEARING_INPUT_KEYS:
        match = SKILL_FILE_PATTERN.search(str(tool_input.get(key, "")))
        if match:
            return match.group(1)
    return ""


def last_agent_message(stream: str) -> str:
    """The session's final prose, from Codex's own events."""
    text = ""
    for event in _json_lines(stream):
        item = event.get("item") or {}
        if event.get("type") == "item.completed" and item.get("type") == "agent_message":
            text = item.get("text", "") or text
    return " ".join(text.split())


def turn_failure_text(stream: str) -> str:
    """The message a failed turn ended on, or "" for a turn that completed."""
    for event in _json_lines(stream):
        if event.get("type") == "turn.failed":
            return (event.get("error") or {}).get("message", "") or "turn failed"
    return ""


def reported_error_texts(stream: str) -> list[str]:
    """Every error Codex reported, those it retried past included — so not, alone, a failed session."""
    return [event.get("message", "") for event in _json_lines(stream) if event.get("type") == "error"]


def session_has_ended(trace: str) -> bool:
    """True once the session routed, or spent the tool calls a Claude session's turn cap allows."""
    calls = list(iter_tool_calls(trace))
    return len(calls) >= SESSION_MAX_TOOL_CALLS or any(skill_opened_by(tool_input) for _, tool_input in calls)


def codex_command(codex_bin: str) -> list[str]:
    """argv that runs Codex: the native binary, or the npm package's `bin/codex.js` under node."""
    if codex_bin.endswith((".js", ".mjs")):
        return [os.environ.get("NODE", "node"), codex_bin]
    return [codex_bin]


def _stop(proc: subprocess.Popen) -> None:
    """End a session and everything it started: the npm wrapper, Codex, its hooks."""
    if proc.poll() is not None:
        return
    if os.name == "posix":
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    else:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
    proc.wait()


def run_codex_once(query: str, repo_root: str, timeout: int, model: str | None) -> tuple[str, str]:
    """One `codex exec` session, ended at its first route. Returns (status, stream)
    where status is OK | TIMEOUT | THROTTLED | ERROR and the stream holds Codex's
    JSONL followed by the traced tool calls."""
    cmd = codex_command(os.environ.get("CODEX_BIN", "codex")) + list(CODEX_EXEC_FLAGS)
    cmd += ["--sandbox", os.environ.get(SANDBOX_ENV, DEFAULT_CODEX_SANDBOX)]
    if model:
        cmd += ["--model", model]
    cmd.append(query)

    # A killed session can leave a handle open for a moment on Windows; the
    # files are scratch, so a failed cleanup is not a failed run.
    with tempfile.TemporaryDirectory(prefix="codex-route-", ignore_cleanup_errors=True) as scratch:
        trace_path = Path(scratch) / "trace.jsonl"
        trace_path.touch()
        stdout_path = Path(scratch) / "stdout.jsonl"
        stderr_path = Path(scratch) / "stderr.txt"
        env = {**os.environ, ROUTE_TRACE_ENV: str(trace_path)}
        ended_at_route = False
        with open(stdout_path, "wb") as stdout_file, open(stderr_path, "wb") as stderr_file:
            proc = subprocess.Popen(
                cmd,
                cwd=repo_root,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=stdout_file,
                stderr=stderr_file,
                start_new_session=(os.name == "posix"),
            )
            deadline = time.monotonic() + timeout
            while proc.poll() is None:
                if session_has_ended(trace_path.read_text(encoding="utf-8", errors="replace")):
                    ended_at_route = True
                    break
                if time.monotonic() > deadline:
                    _stop(proc)
                    return ("TIMEOUT", "")
                time.sleep(TRACE_POLL_SECONDS)
            _stop(proc)
        stream = stdout_path.read_text(encoding="utf-8", errors="replace")
        trace = trace_path.read_text(encoding="utf-8", errors="replace")
        err = stderr_path.read_text(encoding="utf-8", errors="replace")

    # A session ended from here exits on a signal, which is not a failure: the
    # route it reached is already in the trace.
    failure = turn_failure_text(stream)
    if not ended_at_route and (proc.returncode != 0 or failure):
        if throttle.is_throttle_text("\n".join([failure, *reported_error_texts(stream), err])):
            return ("THROTTLED", "")
        sys.stderr.write(
            f"  [route ERROR] rc={proc.returncode}"
            f" stderr={err.strip()[-1500:]!r}"
            f" stream={failure.strip()[:500]!r}\n"
        )
        sys.stderr.flush()
        return ("ERROR", "")
    return ("OK", f"{stream}\n{trace}")


def install_route_tracer(codex_home: Path) -> Path:
    """Write the user-level hooks.json that runs the tracer before every tool call."""
    hooks = {
        "description": "Installed by the muggle routing eval: appends every tool call to $MUGGLE_ROUTE_TRACE.",
        "hooks": {
            "PreToolUse": [
                {"hooks": [{"type": "command", "command": f'node "{ROUTE_TRACER_HOOK}"', "timeout": 10}]},
            ],
        },
    }
    path = codex_home / "hooks.json"
    path.write_text(json.dumps(hooks, indent=2) + "\n", encoding="utf-8")
    return path


def prepare_codex_home(codex_home: Path, codex_bin: str, checkout: Path) -> None:
    """Install the plugin from `checkout` into `codex_home` the way a user does, plus the tracer."""
    codex_home.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "CODEX_HOME": str(codex_home)}
    for args in (["plugin", "marketplace", "add", str(checkout)], ["plugin", "add", CODEX_PLUGIN_ID]):
        subprocess.run(codex_command(codex_bin) + args, env=env, check=True, stdin=subprocess.DEVNULL)
    install_route_tracer(codex_home)


def main() -> None:
    ap = argparse.ArgumentParser(description="Prepare a CODEX_HOME for the routing eval.")
    sub = ap.add_subparsers(dest="command", required=True)
    prepare = sub.add_parser("prepare", help="install the plugin from this checkout and the route tracer")
    prepare.add_argument("--codex-home", default=os.environ.get("CODEX_HOME"), help="defaults to $CODEX_HOME")
    prepare.add_argument("--codex-bin", default=os.environ.get("CODEX_BIN", "codex"))
    prepare.add_argument("--checkout", default=str(CHECKOUT_ROOT))
    args = ap.parse_args()
    if not args.codex_home:
        ap.error("--codex-home is required when CODEX_HOME is unset")
    codex_home = Path(args.codex_home).resolve()
    prepare_codex_home(codex_home, args.codex_bin, Path(args.checkout).resolve())
    print(f"prepared {codex_home}: {CODEX_PLUGIN_ID} installed, route tracer at {ROUTE_TRACER_HOOK}")


if __name__ == "__main__":
    main()
