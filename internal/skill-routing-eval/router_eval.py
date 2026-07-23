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

NONE = "none"

# Shared across the worker pool: one rate-limited run pauses new starts for all.
THROTTLE_GATE = throttle.ThrottleGate()


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
        "--max-turns", "1",
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
        if proc.returncode != 0:
            return ("ERROR", "")
    return ("OK", out)


def detect_route(query: str, repo_root: str, timeout: int, model: str | None) -> str:
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
            return parse_route_from_stream(out)
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
        print(detect_route(args.probe, args.repo_root, args.timeout, args.model))
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
            with lock:
                done += 1
                print(f"  {done}/{len(jobs)} runs done (last route={route})", file=sys.stderr, flush=True)

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
        if expected == NONE:
            # Negative class: pass iff NO muggle skill fired. An appropriate
            # non-muggle skill (systematic-debugging, review, brainstorming...)
            # winning is correct — it means no muggle skill over-triggered.
            ok = not majority.startswith("muggle")
        else:
            ok = (majority == expected)
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
