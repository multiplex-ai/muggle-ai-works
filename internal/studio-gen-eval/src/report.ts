import * as fs from "node:fs";
import * as path from "node:path";

import { caseTitle, passRate, summariseCase } from "./scorer.js";
import {
  type BatchConfig,
  type BatchReport,
  type CaseSummary,
  type GoldenSet,
  OutcomeClass,
  type RepResult,
} from "./types.js";

function groupByCase (reps: RepResult[]): Map<string, RepResult[]> {
  const byCase = new Map<string, RepResult[]>();
  for (const r of reps) {
    const list = byCase.get(r.testCaseId) ?? [];
    list.push(r);
    byCase.set(r.testCaseId, list);
  }
  return byCase;
}

function tally (reps: RepResult[]): Record<string, number> {
  const buckets: Record<string, number> = {};
  for (const r of reps) {
    if (r.bucket) buckets[r.bucket] = (buckets[r.bucket] ?? 0) + 1;
  }
  return buckets;
}

/** Aggregate raw reps into the persisted batch report. */
export function buildReport (
  batchId: string,
  golden: GoldenSet,
  config: BatchConfig,
  reps: RepResult[],
): BatchReport {
  const goldenById = new Map(golden.cases.map((c) => [c.testCaseId, c]));
  const cases: CaseSummary[] = [...groupByCase(reps)].map(([id, rs]) =>
    summariseCase(id, caseTitle(goldenById.get(id), id), rs),
  );
  cases.sort((a, b) => a.passRate - b.passRate);

  const passes = reps.filter((r) => r.outcome === OutcomeClass.Pass).length;
  const fails = reps.filter((r) => r.outcome === OutcomeClass.Fail).length;
  const errors = reps.filter((r) => r.outcome === OutcomeClass.Error).length;

  return {
    batchId: batchId,
    recordedAt: new Date().toISOString(),
    sourceProjectId: golden.sourceProjectId,
    runsPerCase: config.runs,
    flags: config.flags,
    overallPassRate: passRate(passes, fails),
    scoredReps: passes + fails,
    infraErrors: errors,
    buckets: tally(reps),
    cases: cases,
    reps: reps,
  };
}

function pct (n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** Human-readable summary, lowest pass-rate first so the worst cases lead. */
export function renderMarkdown (report: BatchReport): string {
  const flags = Object.keys(report.flags).length > 0 ? JSON.stringify(report.flags) : "(none)";
  const lines: string[] = [
    `# Studio generation eval — ${report.batchId}`,
    "",
    `- Recorded: ${report.recordedAt}`,
    `- Source project: ${report.sourceProjectId}`,
    `- Runs per case: ${report.runsPerCase}`,
    `- Feature flags: ${flags}`,
    `- **Overall pass-rate: ${pct(report.overallPassRate)}** (${report.scoredReps} scored reps; ${report.infraErrors} infra errors excluded)`,
    "",
    "## Failure-mode buckets",
    "",
  ];
  const bucketKeys = Object.keys(report.buckets).sort((a, b) => report.buckets[b] - report.buckets[a]);
  if (bucketKeys.length === 0) {
    lines.push("_none_");
  } else {
    for (const k of bucketKeys) lines.push(`- ${k}: ${report.buckets[k]}`);
  }
  lines.push("", "## Per case (worst first)", "", "| Pass-rate | Pass | Fail | Err | Case |", "| --- | --- | --- | --- | --- |");
  for (const c of report.cases) {
    lines.push(`| ${pct(c.passRate)} | ${c.passes} | ${c.fails} | ${c.errors} | ${c.title} |`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Write `<dir>/<batchId>.json` + `<dir>/<batchId>.md`; returns both paths. */
export function writeReport (dir: string, report: BatchReport): { jsonPath: string; mdPath: string } {
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, `${report.batchId}.json`);
  const mdPath = path.join(dir, `${report.batchId}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, renderMarkdown(report));
  return { jsonPath: jsonPath, mdPath: mdPath };
}
