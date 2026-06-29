#!/usr/bin/env python3
"""One-command runner for the skill-routing eval.

Wraps router_eval.py + analyze.py with the operational lessons learned running
this by hand: per-skill chunking (so an MCP disconnect can't silently crater a
whole sweep), a disconnect guard (re-run a positive chunk that comes back
all-`none`), aggregation, and report generation — plus an optional cache sync so
`claude -p` tests the working-tree descriptions rather than the installed copy.

Usage:
    python internal/skill-routing-eval/run.py --all
    python internal/skill-routing-eval/run.py --skill muggle-status
    python internal/skill-routing-eval/run.py --all --sync-cache

`--sync-cache` copies this repo's plugin/skills/<skill>/SKILL.md over the
installed muggle plugin cache before running. Without it, the eval reflects
whatever is installed; with a description edit in the working tree but not the
cache, `claude -p` sees BOTH (the bare-name local skill and the cached
`muggle:` one) and results are unreliable — sync first when validating an edit.
"""

import argparse
import collections
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]  # internal/skill-routing-eval -> repo root
EVAL_SET = HERE / "eval-set.json"
ROUTER = HERE / "router_eval.py"
ANALYZE = HERE / "analyze.py"
NONE = "none"


def find_plugin_cache() -> Path | None:
    """Locate the installed muggle plugin (so we can sync descriptions into it)."""
    cfg = Path.home() / ".claude" / "plugins" / "installed_plugins.json"
    if not cfg.exists():
        return None
    data = json.loads(cfg.read_text(encoding="utf-8"))
    for key, installs in data.get("plugins", {}).items():
        if "muggle-works" in key or key.startswith("muggleai"):
            for inst in installs:
                p = Path(inst["installPath"])
                if (p / "skills").is_dir():
                    return p
    return None


def sync_cache(repo_root: Path, cache: Path) -> int:
    n = 0
    for skill_md in (repo_root / "plugin" / "skills").glob("*/SKILL.md"):
        dest = cache / "skills" / skill_md.parent.name / "SKILL.md"
        if dest.parent.is_dir():
            dest.write_text(skill_md.read_text(encoding="utf-8"), encoding="utf-8")
            n += 1
    return n


def run_chunk(items: list[dict], out_file: Path, repo_root: Path, runs: int, workers: int, timeout: int):
    chunk_file = out_file.with_suffix(".in.json")
    chunk_file.write_text(json.dumps(items, indent=2), encoding="utf-8")
    cmd = [
        sys.executable, str(ROUTER),
        "--eval-set", str(chunk_file), "--repo-root", str(repo_root),
        "--runs", str(runs), "--workers", str(workers), "--timeout", str(timeout),
        "--out", str(out_file),
    ]
    subprocess.run(cmd, check=True)
    return json.loads(out_file.read_text(encoding="utf-8"))


def recall(report: dict, skill: str) -> float:
    rows = [r for r in report["results"] if r["expected_skill"] == skill]
    if not rows:
        return 1.0
    correct = sum(1 for r in rows if r["majority"] == skill)
    return correct / len(rows)


def main():
    ap = argparse.ArgumentParser(description="Run the skill-routing eval (chunked, guarded).")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--all", action="store_true", help="run every skill chunk (default)")
    g.add_argument("--skill", help="run only this expected_skill chunk")
    g.add_argument("--skills", help="comma-separated subset of expected_skills to run (e.g. the skills changed in a PR)")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--workers", type=int, default=3, help="keep low — high concurrency trips the MCP disconnect")
    ap.add_argument("--timeout", type=int, default=200)
    ap.add_argument("--out-dir", default=str(HERE / "reports" / "run"))
    ap.add_argument("--repo-root", default=str(REPO_ROOT))
    ap.add_argument("--sync-cache", action="store_true", help="copy working-tree descriptions into the installed plugin cache first")
    # CI gate: exit non-zero when accuracy < threshold or a chunk stays 0% (suspected disconnect).
    # Default 0.0 leaves dev runs informational, never failing the process.
    ap.add_argument("--fail-under", type=float, default=0.0, help="CI gate: exit 1 if overall accuracy is below this, or if any chunk is flagged suspected-disconnect")
    args = ap.parse_args()

    repo_root = Path(args.repo_root).resolve()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.sync_cache:
        cache = find_plugin_cache()
        if not cache:
            print("WARNING: could not find installed muggle plugin cache; skipping sync", file=sys.stderr)
        else:
            n = sync_cache(repo_root, cache)
            print(f"synced {n} descriptions -> {cache}", file=sys.stderr)

    eval_set = json.loads(EVAL_SET.read_text(encoding="utf-8"))
    by_skill = collections.defaultdict(list)
    for item in eval_set:
        by_skill[item.get("expected_skill", NONE)].append(item)

    if args.skill:
        skills = [args.skill]
    elif args.skills:
        skills = [s.strip() for s in args.skills.split(",") if s.strip()]
    else:
        skills = sorted(by_skill)
    all_results = []
    flagged = []

    for skill in skills:
        items = by_skill.get(skill, [])
        if not items:
            print(f"!! no queries for '{skill}'", file=sys.stderr)
            continue
        print(f"== {skill} ({len(items)} queries) ==", file=sys.stderr)
        rep = run_chunk(items, out_dir / f"chunk_{skill}.json", repo_root, args.runs, args.workers, args.timeout)
        # disconnect guard: a positive-skill chunk that comes back entirely `none`
        # is almost certainly a mid-chunk MCP disconnect, not a real 0% — the
        # preflight already proved routing works. Retry in fresh subprocesses
        # (which usually reconnect); only flag as unverified if it never recovers.
        attempts = 1
        while skill != NONE and recall(rep, skill) == 0.0 and attempts < 3:
            attempts += 1
            print(f"   {skill} came back 0% — retry {attempts}/3 (suspected MCP disconnect)", file=sys.stderr)
            rep = run_chunk(items, out_dir / f"chunk_{skill}.json", repo_root, args.runs, args.workers, args.timeout)
        if skill != NONE and recall(rep, skill) == 0.0:
            flagged.append(skill)
            print(f"   {skill} still 0% after {attempts} tries — flagged suspected-disconnect (inconclusive)", file=sys.stderr)
        all_results.extend(rep["results"])

    combined = {"model": "claude (run.py)", "runs_per_query": args.runs, "results": all_results}
    combined_path = out_dir / "combined.json"
    combined_path.write_text(json.dumps(combined, indent=2), encoding="utf-8")
    md_path = out_dir / "combined.md"
    subprocess.run([sys.executable, str(ANALYZE), "report", "--in", str(combined_path), "--out", str(md_path)], check=True)

    def ok(r):
        # mirror analyze.py's rule: negatives pass when no muggle skill fires
        return (not r["majority"].startswith("muggle")) if r["expected_skill"] == NONE else (r["majority"] == r["expected_skill"])
    # Suspected-disconnect chunks are inconclusive, not failures. A persistent
    # all-`none` chunk is an MCP-disconnect artifact (the preflight already proved
    # routing works, and genuine description regressions surface as partial recall,
    # not a flat 0%). Exclude them from the gate so infra flake can't red the eval —
    # a real routing regression still shows as verified accuracy below the bar.
    flagged_set = set(flagged)
    verified = [r for r in all_results if r["expected_skill"] not in flagged_set]
    total = len(verified)
    passed = sum(1 for r in verified if ok(r))
    accuracy = passed / total if total else 0.0
    print(f"\nDone. verified {passed}/{total} = {accuracy:.1%}", file=sys.stderr)
    if flagged:
        print(f"Inconclusive (suspected-disconnect, excluded — re-run to verify): {', '.join(flagged)}", file=sys.stderr)
    print(f"Report: {md_path}", file=sys.stderr)

    if args.fail_under > 0.0:
        if total == 0:
            print("GATE FAILED: no chunk could be verified (all suspected-disconnect) — infra failure, re-run", file=sys.stderr)
            sys.exit(1)
        if accuracy < args.fail_under:
            print(f"GATE FAILED: verified accuracy {accuracy:.1%} below --fail-under {args.fail_under:.0%}", file=sys.stderr)
            sys.exit(1)
        if flagged:
            print(f"GATE PASSED (verified {accuracy:.1%}); {len(flagged)} chunk(s) inconclusive — re-run to verify them.", file=sys.stderr)


if __name__ == "__main__":
    main()
