#!/usr/bin/env python3
"""Real-router triggering eval (Windows-safe).

Runs `claude -p "<query>" --max-turns 1` inside the muggle-ai-works repo (where
the muggle plugin is active) and detects which muggle skill, if any, Claude
invokes first. `--max-turns 1` means at most one assistant turn happens, so the
Skill tool may load instructions but no follow-up side-effecting tool ever runs.

Each query is labeled with the skill we expect to fire (or "none"). Every query
runs N times; we report, per query, the distribution of skills that fired plus a
majority-vote pass/fail against the expected label.
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
from scoring import NONE, scored_pass

# Shared across the worker pool: one rate-limited run pauses new starts for all.
THROTTLE_GATE = throttle.ThrottleGate()

PROGRESS_QUERY_CHARS = 140


def format_run_progress(done: int, total: int, query: str, route: str, expected: str) -> str:
    """One live progress line, naming the query that produced `route`.

    Runs complete out of order across the worker pool, so each line has to carry
    its own query — a bare route belongs to whichever of N parallel sessions
    happened to finish. The marker scores this single run against the query's
    label; reported accuracy still scores the majority route across its runs.

    Output shape: `  12/78 MISS route=none :: test my changes before I open the PR`
    """
    marker = "ok  " if scored_pass(expected, route) else "MISS"
    shown = " ".join(query.split())
    if len(shown) > PROGRESS_QUERY_CHARS:
        shown = shown[: PROGRESS_QUERY_CHARS - 3] + "..."
    return f"  {done}/{total} {marker} route={route} :: {shown}"


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


def parse_route_from_stream(out: str) -> str:
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        etype = event.get("type")
        if etype == "assistant":
            for ci in event.get("message", {}).get("content", []):
                if ci.get("type") != "tool_use":
                    continue
                tname = ci.get("name", "")
                inp = ci.get("input", {})
                if tname == "Skill":
                    return normalize_skill(inp.get("skill", "")) or NONE
                if tname == "Read":
                    return _route_from_path(inp.get("file_path", "")) or NONE
                return NONE
        elif etype == "result":
            return NONE
    return NONE


# The preflight probe runs in an empty clean-cwd, where a realistic query like
# "test my changes before I open the PR" makes the model orient first (pwd/ls/
# git status) and only then route. Scoring the *first* tool_use there reports
# `none` for a perfectly healthy plugin, which is what used to fail the gate.
# The probe therefore gets an extra turn and scans the whole session for a skill
# invocation; the 391-query eval keeps the strict first-tool-use semantics.
PROBE_MAX_TURNS = 2


def parse_route_probe(out: str) -> str:
    """Route detection for the CI preflight: any Skill invocation anywhere in the
    session counts, so an orienting tool call before the route is not a failure."""
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
        for ci in event.get("message", {}).get("content", []):
            if ci.get("type") != "tool_use":
                continue
            if ci.get("name") == "Skill":
                skill = normalize_skill(ci.get("input", {}).get("skill", ""))
                if skill:
                    return skill
            if ci.get("name") == "Read":
                skill = _route_from_path(ci.get("input", {}).get("file_path", ""))
                if skill:
                    return skill
            # Muggle ships its MCP tools deferred, so a healthy session often
            # loads them via ToolSearch before invoking anything else. Reaching
            # for a muggle tool proves the plugin is loaded and routable just as
            # a Skill call does — scoring it `none` failed the gate on a session
            # that was working perfectly.
            name = ci.get("name", "")
            if name.startswith("mcp__") and "muggle" in name:
                return "muggle-mcp-tool"
            if name == "ToolSearch" and "muggle" in str(ci.get("input", {})).lower():
                return "muggle-tools"
    return NONE


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


def run_claude_once(query: str, repo_root: str, timeout: int, model: str | None, max_turns: int = 1) -> tuple[str, str]:
    """One isolated `claude -p` session. Returns (status, stdout) where status is
    OK | TIMEOUT | THROTTLED | ERROR."""
    cmd = [
        "claude", "-p", query,
        "--output-format", "stream-json",
        "--verbose",
        "--max-turns", str(max_turns),
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
        # A `--max-turns 1` probe that routes invokes a skill/tool on its only
        # allowed turn; newer CLIs then exit non-zero with an `error_max_turns`
        # result. The route intent is already in the stream (the tool_use), so
        # this is a completed probe, not a broken session, so parse it as normal.
        # Without this, every successful route scores as ERROR.
        if "error_max_turns" in out:
            return ("OK", out)
        if proc.returncode != 0:
            # Surface why the probe failed — an ERROR the caller only sees as the
            # bare string is undiagnosable; the stderr/stream text names the cause
            # (plugin load failure, auth rejection, crash).
            sys.stderr.write(
                f"  [probe ERROR] rc={proc.returncode}"
                f" stderr={err.strip()[:1500]!r}"
                f" stream={error_text.strip()[:500]!r}"
                f" stdout_tail={out.strip()[-500:]!r}\n"
            )
            sys.stderr.flush()
            return ("ERROR", "")
    return ("OK", out)


def detect_route(query: str, repo_root: str, timeout: int, model: str | None, probe: bool = False) -> str:
    attempt = 1
    while True:
        THROTTLE_GATE.wait_until_clear()
        status, out = run_claude_once(query, repo_root, timeout, model, PROBE_MAX_TURNS if probe else 1)
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
            return parse_route_probe(out) if probe else parse_route_from_stream(out)
        # TIMEOUT / ERROR / THROTTLED-with-retries-exhausted: all non-muggle
        # strings, so they score exactly like the old silent `none` on negatives
        # while staying attributable in the fired[] lists.
        return status


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
        print(detect_route(args.probe, args.repo_root, args.timeout, args.model, probe=True))
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
            i, route = fut.result()
            results[i] = route
            qi, query = jobs[i]
            expected = eval_set[qi].get("expected_skill", NONE)
            with lock:
                done += 1
                print(
                    format_run_progress(done, len(jobs), query, route, expected),
                    file=sys.stderr, flush=True,
                )

    fired: dict[int, list[str]] = {}
    for i, route in enumerate(results):
        qi = jobs[i][0]
        fired.setdefault(qi, []).append(route)

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
