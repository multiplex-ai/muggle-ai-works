#!/usr/bin/env python3
"""One-command runner for the skill-routing eval.

Wraps router_eval.py + analyze.py with the operational lessons learned running
this by hand: one pooled sweep across every selected skill (so no worker idles
through a chunk's tail), a disconnect guard (re-run a positive skill that comes
back all-`none` in a fresh subprocess), aggregation, and report generation —
plus an optional cache sync so `claude -p` tests the working-tree descriptions
rather than the installed copy.

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

from gate_constants import BASELINE_FILENAME, BASELINE_SOURCE_FULL_SWEEP
from pool_constants import DEFAULT_ROUTING_WORKERS, MAX_DISCONNECT_ATTEMPTS
from pooling import partition_results_by_skill, plan_pooled_items, resolve_disconnect_retries
from regression_gate import build_baseline, format_gate_report, gate_failures, judge_run, load_baseline
from scoring import NONE, scored_pass

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]  # internal/skill-routing-eval -> repo root
EVAL_SET = HERE / "eval-set.json"
BASELINE = HERE / BASELINE_FILENAME
ROUTER = HERE / "router_eval.py"
ANALYZE = HERE / "analyze.py"


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


def has_no_coverage(skills: list[str], by_skill: dict) -> bool:
    return not any(by_skill.get(s) for s in skills)


def main():
    ap = argparse.ArgumentParser(description="Run the skill-routing eval (chunked, guarded).")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--all", action="store_true", help="run every skill chunk (default)")
    g.add_argument("--skill", help="run only this expected_skill chunk")
    g.add_argument("--skills", help="comma-separated subset of expected_skills to run (e.g. the skills changed in a PR)")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--workers", type=int, default=DEFAULT_ROUTING_WORKERS, help="parallel claude sessions across the pooled sweep; router_eval's per-run throttle retry + shared backoff make higher values safe")
    ap.add_argument("--timeout", type=int, default=200)
    ap.add_argument("--out-dir", default=str(HERE / "reports" / "run"))
    ap.add_argument("--repo-root", default=str(REPO_ROOT))
    ap.add_argument("--sync-cache", action="store_true", help="copy working-tree descriptions into the installed plugin cache first")
    # Off by default, so dev runs stay informational and never fail the process.
    ap.add_argument("--gate", action="store_true", help="CI gate: exit 1 if a skill regressed against the recorded baseline or collapsed")
    ap.add_argument("--baseline", default=str(BASELINE), help="recorded per-skill baseline the gate compares against")
    ap.add_argument("--record-baseline", help="write this run's per-skill tallies to PATH as a baseline candidate (full sweeps only)")
    args = ap.parse_args()

    if args.record_baseline and (args.skill or args.skills):
        print("--record-baseline needs a full sweep; a scoped run would drop every skill it did not measure", file=sys.stderr)
        sys.exit(2)

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

    # A PR that only touches skills with no positive queries in the eval-set
    # (e.g. muggle-do) has nothing to route-test. Skip cleanly with a posted note
    # rather than running zero chunks and hitting analyze.py's empty-input path —
    # re-running would never help, so this must not red the check.
    if has_no_coverage(skills, by_skill):
        missing = ", ".join(skills) or "(none)"
        msg = (
            f"No routing queries cover the requested skill(s): {missing}. "
            "The eval-set has no positive queries for them, so there is nothing "
            "to evaluate — passing."
        )
        print(msg, file=sys.stderr)
        combined = {"model": "claude (run.py)", "runs_per_query": args.runs, "results": []}
        (out_dir / "combined.json").write_text(json.dumps(combined, indent=2), encoding="utf-8")
        (out_dir / "combined.md").write_text("# Router eval report\n\n- " + msg + "\n", encoding="utf-8")
        print(f"Report: {out_dir / 'combined.md'}", file=sys.stderr)
        return

    for uncovered in [s for s in skills if not by_skill.get(s)]:
        print(f"!! no queries for '{uncovered}'", file=sys.stderr)

    planned = plan_pooled_items(skills, by_skill)
    print(
        f"== pooled sweep: {len(planned)} queries x {args.runs} runs, {args.workers} workers ==",
        file=sys.stderr,
    )
    pooled = run_chunk(planned, out_dir / "chunk_pooled.json", repo_root, args.runs, args.workers, args.timeout)

    def rerun_skill(skill: str) -> list[dict]:
        """One skill's queries alone, in a fresh subprocess that usually reconnects."""
        rep = run_chunk(by_skill[skill], out_dir / f"chunk_{skill}.json", repo_root, args.runs, args.workers, args.timeout)
        return rep["results"]

    def announce_retry(skill: str, attempt: int, limit: int) -> None:
        print(f"   {skill} came back 0% — retry {attempt}/{limit} (suspected MCP disconnect)", file=sys.stderr)

    grouped, flagged = resolve_disconnect_retries(
        partition_results_by_skill(pooled["results"], skills),
        rerun_skill,
        on_retry=announce_retry,
    )
    for skill in flagged:
        print(
            f"   {skill} still 0% after {MAX_DISCONNECT_ATTEMPTS} tries — flagged suspected-disconnect (inconclusive)",
            file=sys.stderr,
        )
    all_results = [row for skill in skills for row in grouped.get(skill, [])]

    combined = {"model": "claude (run.py)", "runs_per_query": args.runs, "results": all_results}
    combined_path = out_dir / "combined.json"
    combined_path.write_text(json.dumps(combined, indent=2), encoding="utf-8")
    md_path = out_dir / "combined.md"
    subprocess.run([sys.executable, str(ANALYZE), "report", "--in", str(combined_path), "--out", str(md_path)], check=True)

    # Suspected-disconnect chunks are inconclusive, not failures. A persistent
    # all-`none` chunk is an MCP-disconnect artifact (the preflight already proved
    # routing works, and genuine description regressions surface as partial recall,
    # not a flat 0%). Exclude them from the gate so infra flake can't red the eval —
    # a real routing regression still shows as verified accuracy below the bar.
    flagged_set = set(flagged)
    verified = [r for r in all_results if r["expected_skill"] not in flagged_set]
    total = len(verified)
    passed = sum(1 for r in verified if scored_pass(r["expected_skill"], r["majority"]))
    accuracy = passed / total if total else 0.0
    print(f"\nDone. verified {passed}/{total} = {accuracy:.1%}", file=sys.stderr)
    if flagged:
        print(f"Inconclusive (suspected-disconnect, excluded — re-run to verify): {', '.join(flagged)}", file=sys.stderr)
    print(f"Report: {md_path}", file=sys.stderr)

    if args.record_baseline:
        # Inconclusive chunks would be recorded as a 0% baseline that every later
        # run then trivially beats, so record only what was actually measured.
        candidate = build_baseline(verified, args.runs, BASELINE_SOURCE_FULL_SWEEP)
        Path(args.record_baseline).write_text(json.dumps(candidate, indent=2) + "\n", encoding="utf-8")
        print(f"Baseline candidate: {args.record_baseline}", file=sys.stderr)

    if not args.gate:
        return

    baseline_path = Path(args.baseline)
    if not baseline_path.exists():
        print(f"GATE FAILED: no recorded baseline at {baseline_path} — nothing to compare this run against", file=sys.stderr)
        sys.exit(1)
    if total == 0:
        print("GATE FAILED: no chunk could be verified (all suspected-disconnect) — infra failure, re-run", file=sys.stderr)
        sys.exit(1)

    run_verdict = judge_run(all_results, load_baseline(baseline_path), flagged_set)
    for line in format_gate_report(run_verdict):
        print(line, file=sys.stderr)
    if flagged:
        print(f"{len(flagged)} chunk(s) inconclusive and ungated — re-run to verify them.", file=sys.stderr)
    if gate_failures(run_verdict) or run_verdict.overall_regressed:
        sys.exit(1)


if __name__ == "__main__":
    main()
