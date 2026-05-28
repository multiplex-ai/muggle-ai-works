#!/usr/bin/env python3
"""Analyze a router-eval report and derive per-skill signal.

Two modes:
  report  -- print/write a human report: overall accuracy, per-skill recall,
             the confusion pairs (who steals whose queries), and the miss list.
  derive  -- for a target skill, emit a run_eval.py-format results JSON so
             improve_description.py can propose a better description. A query is
             should_trigger iff its expected_skill == target; pass iff the
             majority-fired skill matches that expectation; triggers = number of
             runs in which the target skill actually fired.
"""

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

NONE = "none"


def is_muggle(route: str) -> bool:
    return route.startswith("muggle")


def scored_pass(expected: str, majority: str) -> bool:
    """Negative class passes iff no muggle skill fired; positives need an exact match."""
    if expected == NONE:
        return not is_muggle(majority)
    return majority == expected


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def derive(report, target):
    results = []
    passed = 0
    for r in report["results"]:
        runs = r["fired"]
        n = len(runs)
        trig = sum(1 for f in runs if f == target)
        should = (r["expected_skill"] == target)
        if should:
            did_pass = (r["majority"] == target)
        else:
            did_pass = (r["majority"] != target)
        passed += int(did_pass)
        results.append({
            "query": r["query"],
            "should_trigger": should,
            "trigger_rate": trig / n if n else 0,
            "triggers": trig,
            "runs": n,
            "pass": did_pass,
        })
    return {
        "skill_name": target,
        "description": "",
        "results": results,
        "summary": {"total": len(results), "passed": passed, "failed": len(results) - passed},
    }


def per_skill_report(report):
    rows_all = report["results"]
    for r in rows_all:
        r["_pass"] = scored_pass(r["expected_skill"], r["majority"])
    passed = sum(1 for r in rows_all if r["_pass"])
    total = len(rows_all)

    pos_skills = sorted({r["expected_skill"] for r in rows_all if r["expected_skill"] != NONE})
    lines = []
    lines.append("# Router eval report")
    lines.append("")
    lines.append(f"- model: `{report.get('model')}`  runs/query: {report.get('runs_per_query')}")
    lines.append(f"- overall accuracy (muggle-routing): **{passed}/{total} = {passed/total:.1%}**")
    lines.append("- negative-class rule: a query labeled `none` passes when no `muggle*` skill fires; an appropriate non-muggle skill (debugging, review, brainstorming) winning is correct.")
    lines.append("")

    by_expected = defaultdict(list)
    for r in rows_all:
        by_expected[r["expected_skill"]].append(r)

    lines.append("## Per-skill recall (positive queries)")
    lines.append("")
    lines.append("| skill | correct | total | recall | stolen by (majority when wrong) |")
    lines.append("|---|---|---|---|---|")
    for s in pos_skills:
        rws = by_expected.get(s, [])
        correct = sum(1 for r in rws if r["majority"] == s)
        stolen = Counter(r["majority"] for r in rws if r["majority"] != s)
        stolen_str = ", ".join(f"{k}×{v}" for k, v in stolen.most_common()) or "—"
        flag = "" if correct == len(rws) else "  ⚠"
        lines.append(f"| {s} | {correct} | {len(rws)} | {correct/len(rws):.0%}{flag} | {stolen_str} |")
    lines.append("")

    # Negative class
    negs = by_expected.get(NONE, [])
    bad_neg = [r for r in negs if is_muggle(r["majority"])]
    lines.append("## Negative class (must not fire a muggle skill)")
    lines.append("")
    lines.append(f"- {len(negs) - len(bad_neg)}/{len(negs)} clean (no muggle skill fired).")
    if bad_neg:
        lines.append("- ⚠ muggle skill wrongly fired:")
        for r in bad_neg:
            lines.append(f"  - `{r['query'][:70]}` → **{r['majority']}** (fired {dict(Counter(r['fired']))})")
    else:
        lines.append("- No muggle skill over-triggered on any near-miss. ✔")
    lines.append("")

    # Genuine misses only
    lines.append("## Genuine misses")
    lines.append("")
    misses = [r for r in rows_all if not r["_pass"]]
    if not misses:
        lines.append("None — all pass.")
    for r in misses:
        lines.append(f"- expected `{r['expected_skill']}` got `{r['majority']}` — {r['query'][:75]}  (fired: {dict(Counter(r['fired']))})")
    lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    rp = sub.add_parser("report")
    rp.add_argument("--in", dest="inp", required=True)
    rp.add_argument("--out", required=True)

    dp = sub.add_parser("derive")
    dp.add_argument("--in", dest="inp", required=True)
    dp.add_argument("--skill", required=True)
    dp.add_argument("--description", default="")
    dp.add_argument("--out", required=True)

    args = ap.parse_args()
    report = load(args.inp)

    if args.cmd == "report":
        Path(args.out).write_text(per_skill_report(report), encoding="utf-8")
        print(f"wrote {args.out}")
    elif args.cmd == "derive":
        d = derive(report, args.skill)
        d["description"] = args.description
        Path(args.out).write_text(json.dumps(d, indent=2), encoding="utf-8")
        s = d["summary"]
        print(f"{args.skill}: {s['passed']}/{s['total']} pass")


if __name__ == "__main__":
    main()
