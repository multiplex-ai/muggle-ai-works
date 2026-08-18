#!/usr/bin/env python3
"""Real-router triggering eval (Windows-safe).

Runs a turn-capped `claude -p "<query>"` inside the muggle-ai-works repo (where
the muggle plugin is active) and detects which muggle skill, if any, Claude
invokes. The cap leaves room to orient before routing, and ends the session
once the route is made, so the routed skill never runs anything.

Each query is labeled with the skill we expect to fire (or "none"). Every query
runs N times; we report, per query, the distribution of skills that fired plus a
majority-vote pass/fail against the expected label. A run that reached no skill
also records why it never routed — diagnostic data alongside the route, scored
as nothing.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock

import throttle
from route_constants import (
    COMMAND_VERB_EDGE_CHARS,
    DISCARDED_REDIRECT,
    INSPECTION_COMMANDS,
    INSPECTION_TOOL_NAMES,
    MAX_COMMAND_VERB_TOKENS,
    OUTPUT_REDIRECT,
    REPORT_NONE_REASONS_FIELD,
    SHELL_TOOL_NAMES,
)
from route_types import NoneReason, RouteOutcome
from scoring import NONE, scored_pass

# Shared across the worker pool: one rate-limited run pauses new starts for all.
THROTTLE_GATE = throttle.ThrottleGate()

PROGRESS_QUERY_CHARS = 140

# Two turns, because a realistic query spends the first one orienting (`git
# status`, `ls`) and only routes on the second; a one-turn cap ends the session
# before the route ever reaches the stream.
SESSION_MAX_TURNS = 2

# The plugin tree sits beside `internal/` in the checkout, so the map is anchored
# to this file: `--repo-root` points at a throwaway clean cwd in CI, not here.
PLUGIN_SKILLS_DIR = Path(__file__).resolve().parents[2] / "plugin" / "skills"

ALIAS_TARGET_PATTERN = re.compile(
    r"^description:.*\balias for the `([^`]+)` skill", re.MULTILINE
)

COMMAND_SEGMENT_PATTERN = re.compile(r"&&|\|\||[;|\n]")

DISCARDED_REDIRECT_PATTERN = re.compile(DISCARDED_REDIRECT, re.IGNORECASE)


def build_alias_to_canonical(skills_dir: Path) -> dict[str, str]:
    """Alias skill name to the canonical skill it delegates to, read from SKILL.md frontmatter.

    Derived from the tree rather than listed here, so an alias added later is
    resolved without touching the eval. A missing or unreadable skills tree
    yields an empty map, leaving routes unresolved rather than ending the run.

    Output shape: `{"mfeedback": "muggle-feedback", "mtestlocal": "muggle-test-feature-local"}`
    """
    alias_to_canonical: dict[str, str] = {}
    try:
        skill_files = sorted(skills_dir.glob("*/SKILL.md"))
    except OSError:
        return alias_to_canonical
    for skill_file in skill_files:
        try:
            declaration = skill_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        target = ALIAS_TARGET_PATTERN.search(declaration)
        if target:
            alias_to_canonical[skill_file.parent.name] = target.group(1)
    return alias_to_canonical


ALIAS_TO_CANONICAL = build_alias_to_canonical(PLUGIN_SKILLS_DIR)


def resolve_alias_route(route: str) -> str:
    """Canonical skill behind an alias route; every other route passes through unchanged.

    Routing through an alias reaches exactly the canonical skill, so scoring the
    bare alias name counts a correct route as a miss — and hides it from the
    negative class, which only rejects routes starting with "muggle".

    Output shape: `"mfeedback"` -> `"muggle-feedback"`
    """
    return ALIAS_TO_CANONICAL.get(route, route)


def format_run_progress(
    done: int,
    total: int,
    query: str,
    route: str,
    expected: str,
    none_reason: NoneReason | None = None,
) -> str:
    """One live progress line, naming the query that produced `route`.

    Runs complete out of order across the worker pool, so each line has to carry
    its own query — a bare route belongs to whichever of N parallel sessions
    happened to finish. The marker scores this single run against the query's
    label; reported accuracy still scores the majority route across its runs. A
    run that reached no skill also names why, so the CI log is diagnosable
    without re-running the query by hand.

    Output shape: `  12/78 MISS route=none (oriented_only) :: test my changes before I open the PR`
    """
    marker = "ok  " if scored_pass(expected, route) else "MISS"
    reason_note = f" ({none_reason.value})" if none_reason else ""
    shown = " ".join(query.split())
    if len(shown) > PROGRESS_QUERY_CHARS:
        shown = shown[: PROGRESS_QUERY_CHARS - 3] + "..."
    return f"  {done}/{total} {marker} route={route}{reason_note} :: {shown}"


def normalize_skill(raw: str) -> str:
    if not raw:
        return ""
    return raw.split(":")[-1].strip()


def _route_from_path(path: str) -> str:
    if not path:
        return ""
    norm = path.replace("\\", "/")
    m = re.search(r"/skills/([^/]+)/SKILL\.md", norm)
    return normalize_skill(m.group(1)) if m else ""


def _iter_tool_calls(out: str):
    """Yields `(tool_name, tool_input)` for every tool_use block, in stream order."""
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") != "assistant":
            continue
        for content_block in event.get("message", {}).get("content", []):
            if content_block.get("type") != "tool_use":
                continue
            yield content_block.get("name", ""), content_block.get("input") or {}


def _route_from_tool_call(tool_name: str, tool_input: dict) -> str:
    """Skill named by an invocation or by a SKILL.md read, or "" when the call is not a route."""
    if tool_name == "Skill":
        return normalize_skill(tool_input.get("skill", ""))
    if tool_name == "Read":
        return _route_from_path(tool_input.get("file_path", ""))
    return ""


def _muggle_tool_signal(tool_name: str, tool_input: dict) -> str:
    """`"muggle-mcp-tool"` or `"muggle-tools"` when the call reaches for muggle tooling, else ""."""
    if tool_name.startswith("mcp__") and "muggle" in tool_name:
        return "muggle-mcp-tool"
    if tool_name == "ToolSearch" and "muggle" in str(tool_input).lower():
        return "muggle-tools"
    return ""


def parse_route_from_session(out: str) -> str:
    """First route reached anywhere in the session, or NONE if it never routed.

    A realistic query makes the model orient (`git status`, `ls`) before it
    routes, so a scan that stops at the first tool_use scores a healthy session
    as a miss. Muggle ships its MCP tools deferred, so a healthy session often
    loads them via ToolSearch before invoking anything else; that proves the
    plugin is loaded but not which skill won, so it only stands in when the whole
    session invoked no skill. Both of its spellings start with "muggle", so they
    miss a positive query expecting a named skill and correctly fail the negative
    class, which passes only when nothing muggle fires. A route that names an
    alias skill is reported as the canonical skill it delegates to.

    Output shape: `"muggle-test"`
    """
    muggle_tool_signal = ""
    for tool_name, tool_input in _iter_tool_calls(out):
        route = _route_from_tool_call(tool_name, tool_input)
        if route:
            return resolve_alias_route(route)
        if not muggle_tool_signal:
            muggle_tool_signal = _muggle_tool_signal(tool_name, tool_input)
    return muggle_tool_signal or NONE


def _is_inspection_command(command: str) -> bool:
    """True when every segment of a shell command reports state without changing it."""
    segments = [seg for seg in COMMAND_SEGMENT_PATTERN.split(command) if seg.strip()]
    if not segments:
        return False
    for segment in segments:
        if OUTPUT_REDIRECT in DISCARDED_REDIRECT_PATTERN.sub("", segment):
            return False
        tokens = [token.strip(COMMAND_VERB_EDGE_CHARS).lower() for token in segment.split()]
        verbs = {" ".join(tokens[:n]) for n in range(1, MAX_COMMAND_VERB_TOKENS + 1)}
        if not verbs & INSPECTION_COMMANDS:
            return False
    return True


def _is_inspection_call(tool_name: str, tool_input: dict) -> bool:
    """True when a tool call looked at the repo rather than acting on it."""
    if tool_name in SHELL_TOOL_NAMES:
        return _is_inspection_command(str(tool_input.get("command", "")))
    return tool_name in INSPECTION_TOOL_NAMES


def classify_none_reason(out: str) -> NoneReason:
    """Why a session that reached no skill never routed, read off its tool calls.

    A bare `none` reads the same whether the model answered the query outright,
    oriented and stopped, or worked the task by hand — and those want different
    fixes (a mislabelled query, a description that never won, a description the
    model never looked for), so the route carries the reason alongside it.

    Output shape: `NoneReason.ORIENTED_ONLY`
    """
    called_a_tool = False
    for tool_name, tool_input in _iter_tool_calls(out):
        called_a_tool = True
        if not _is_inspection_call(tool_name, tool_input):
            return NoneReason.WORKED_BY_HAND
    return NoneReason.ORIENTED_ONLY if called_a_tool else NoneReason.NO_TOOL_CALL


def stream_error_text(out: str) -> str:
    """Text of an `is_error` result event, or "" — a normal result is not an error."""
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "result" and event.get("is_error"):
            return line
    return ""


def run_claude_once(query: str, repo_root: str, timeout: int, model: str | None) -> tuple[str, str]:
    """One isolated `claude -p` session. Returns (status, stdout) where status is
    OK | TIMEOUT | THROTTLED | ERROR."""
    cmd = [
        "claude", "-p", query,
        "--output-format", "stream-json",
        "--verbose",
        "--max-turns", str(SESSION_MAX_TURNS),
    ]
    if model:
        cmd.extend(["--model", model])

    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

    try:
        proc = subprocess.run(
            cmd, cwd=repo_root, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return ("TIMEOUT", "")

    out = proc.stdout.decode("utf-8", errors="replace")
    err = proc.stderr.decode("utf-8", errors="replace")
    error_text = stream_error_text(out)
    if proc.returncode != 0 or error_text:
        # Classify before parsing: a throttled run's stream often still carries a
        # result event, and silently scoring it as `none` is what used to pollute
        # negatives and crater positive chunks into the disconnect guard.
        if throttle.is_throttle_text("\n".join([error_text, err])):
            return ("THROTTLED", "")
        # A session that routes on its last allowed turn leaves the CLI exiting
        # non-zero with an `error_max_turns` result. The route intent is already
        # in the stream (the tool_use), so this is a completed session, not a
        # broken one, and parsing it as normal is what keeps a successful route
        # from scoring as ERROR.
        if "error_max_turns" in out:
            return ("OK", out)
        if proc.returncode != 0:
            # Surface why the session failed — an ERROR the caller only sees as
            # the bare string is undiagnosable; the stderr/stream text names the
            # cause (plugin load failure, auth rejection, crash).
            sys.stderr.write(
                f"  [route ERROR] rc={proc.returncode}"
                f" stderr={err.strip()[:1500]!r}"
                f" stream={error_text.strip()[:500]!r}"
                f" stdout_tail={out.strip()[-500:]!r}\n"
            )
            sys.stderr.flush()
            return ("ERROR", "")
    return ("OK", out)


def detect_route(query: str, repo_root: str, timeout: int, model: str | None) -> RouteOutcome:
    """One query's route, carrying why it never routed when the route is `none`.

    Output shape: `RouteOutcome(route="none", none_reason=NoneReason.ORIENTED_ONLY)`
    """
    attempt = 1
    while True:
        THROTTLE_GATE.wait_until_clear()
        status, out = run_claude_once(query, repo_root, timeout, model)
        if status == "THROTTLED" and attempt <= throttle.MAX_THROTTLE_RETRIES:
            backoff = throttle.backoff_seconds(attempt)
            THROTTLE_GATE.report_throttle(backoff)
            print(
                f"  rate-limited (attempt {attempt}/{throttle.MAX_THROTTLE_RETRIES + 1}) — backing off {backoff:.0f}s",
                file=sys.stderr, flush=True,
            )
            attempt += 1
            continue
        if status == "OK":
            route = parse_route_from_session(out)
            reason = classify_none_reason(out) if route == NONE else None
            return RouteOutcome(route, reason)
        # TIMEOUT / ERROR / THROTTLED-with-retries-exhausted: all non-muggle
        # strings, so they score exactly like the old silent `none` on negatives
        # while staying attributable in the fired[] lists.
        return RouteOutcome(status, None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval-set")
    ap.add_argument("--repo-root", default=".")
    ap.add_argument("--model", default=None)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--out")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--probe", help="route a single query, print the detected skill, and exit (CI preflight)")
    args = ap.parse_args()

    if args.probe:
        outcome = detect_route(args.probe, args.repo_root, args.timeout, args.model)
        if outcome.none_reason:
            # The preflight reads stdout as the bare route, so a failed probe can
            # only explain itself on stderr.
            print(f"  no route: {outcome.none_reason.value}", file=sys.stderr)
        print(outcome.route)
        return
    if not args.eval_set or not args.out:
        ap.error("--eval-set and --out are required unless --probe is given")

    eval_set = json.loads(Path(args.eval_set).read_text(encoding="utf-8"))
    if args.limit:
        eval_set = eval_set[: args.limit]

    jobs = []
    for qi, item in enumerate(eval_set):
        for _ in range(args.runs):
            jobs.append((qi, item["query"]))

    results = [None] * len(jobs)
    done = 0
    lock = Lock()

    def work(i):
        qi, query = jobs[i]
        return i, detect_route(query, args.repo_root, args.timeout, args.model)

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(work, i) for i in range(len(jobs))]
        for fut in as_completed(futs):
            i, outcome = fut.result()
            results[i] = outcome
            qi, query = jobs[i]
            expected = eval_set[qi].get("expected_skill", NONE)
            with lock:
                done += 1
                print(
                    format_run_progress(
                        done, len(jobs), query, outcome.route, expected, outcome.none_reason
                    ),
                    file=sys.stderr, flush=True,
                )

    fired: dict[int, list[str]] = {}
    none_reasons: dict[int, Counter] = {}
    for i, outcome in enumerate(results):
        qi = jobs[i][0]
        fired.setdefault(qi, []).append(outcome.route)
        if outcome.none_reason:
            none_reasons.setdefault(qi, Counter())[outcome.none_reason.value] += 1

    out = []
    passed = 0
    for qi, item in enumerate(eval_set):
        runs = fired.get(qi, [])
        counts = Counter(runs)
        majority = counts.most_common(1)[0][0] if counts else NONE
        expected = item.get("expected_skill", NONE)
        ok = scored_pass(expected, majority)
        passed += int(ok)
        out.append({
            "query": item["query"],
            "expected_skill": expected,
            "fired": runs,
            REPORT_NONE_REASONS_FIELD: dict(none_reasons.get(qi, Counter())),
            "majority": majority,
            "pass": ok,
            "note": item.get("note", ""),
        })

    report = {
        "model": args.model or "default",
        "runs_per_query": args.runs,
        "total": len(eval_set),
        "passed": passed,
        "failed": len(eval_set) - passed,
        "accuracy": round(passed / len(eval_set), 4) if eval_set else 0,
        "results": out,
    }
    Path(args.out).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nAccuracy: {passed}/{len(eval_set)} = {report['accuracy']}", file=sys.stderr)


if __name__ == "__main__":
    main()
