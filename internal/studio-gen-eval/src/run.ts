import "./bootstrap.js";

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { createBackendClient } from "./client/client.js";
import { DEFAULT_CONCURRENCY, DEFAULT_REP_TIMEOUT_MS, DEFAULT_RUNS } from "./domain/constants.js";
import { detectDrift, loadGoldenSet, saveGoldenSet } from "./golden-set/golden-set.js";
import { importProject, liveHashes } from "./golden-set/import.js";
import { planTasks, runBatch } from "./orchestrator/orchestrator.js";
import { buildReport, renderMarkdown, writeReport } from "./report/report.js";
import { type BackendClient, type BatchConfig, type RepResult } from "./domain/types.js";

const TOOL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GOLDEN_PATH = path.join(TOOL_DIR, "golden-set.json");
const REPORTS_DIR = path.join(TOOL_DIR, "reports");
const PARTIAL_PATH = path.join(REPORTS_DIR, "partial.jsonl");

function flagValue (args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function hasFlag (args: string[], name: string): boolean {
  return args.includes(name);
}

function parseFlags (raw: string | undefined): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const [k, v] = pair.split("=");
    if (!k) continue;
    out[k.trim()] = v === undefined ? true : v === "true" ? true : v === "false" ? false : v.trim();
  }
  return out;
}

async function cmdImport (client: BackendClient, args: string[]): Promise<void> {
  const projectId = flagValue(args, "--project");
  if (!projectId) {
    const projects = await client.listProjects();
    process.stdout.write("Pass --project <id>. Available projects:\n");
    for (const p of projects) process.stdout.write(`  ${p.id}  ${p.name}\n`);
    return;
  }
  const set = await importProject(client, projectId);
  saveGoldenSet(GOLDEN_PATH, set);
  process.stdout.write(`Imported ${set.cases.length} case(s) from project ${projectId} -> ${GOLDEN_PATH}\n`);
}

function readPartial (): RepResult[] {
  if (!fs.existsSync(PARTIAL_PATH)) return [];
  return fs
    .readFileSync(PARTIAL_PATH, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as RepResult);
}

async function cmdRun (client: BackendClient, args: string[]): Promise<void> {
  if (!fs.existsSync(GOLDEN_PATH)) {
    throw new Error(`no golden set at ${GOLDEN_PATH} — run \`import --project <id>\` first`);
  }
  const golden = loadGoldenSet(GOLDEN_PATH);
  const config: BatchConfig = {
    runs: Number(flagValue(args, "--runs") ?? DEFAULT_RUNS),
    concurrency: Number(flagValue(args, "--concurrency") ?? DEFAULT_CONCURRENCY),
    repTimeoutMs: flagValue(args, "--timeout") ? Number(flagValue(args, "--timeout")) * 1000 : DEFAULT_REP_TIMEOUT_MS,
    flags: parseFlags(flagValue(args, "--flags")),
    caseFilter: flagValue(args, "--cases")?.split(",").map((s) => s.trim()).filter(Boolean),
    dryRun: hasFlag(args, "--dry-run"),
  };

  const targetGolden = config.caseFilter
    ? { ...golden, cases: golden.cases.filter((c) => config.caseFilter?.includes(c.testCaseId)) }
    : golden;
  try {
    const drifted = detectDrift(targetGolden, await liveHashes(client, targetGolden));
    if (drifted.length > 0) {
      process.stdout.write(`WARNING: ${drifted.length} case(s) drifted from the snapshot since import:\n`);
      for (const c of drifted) process.stdout.write(`  ${c.testCaseId}  ${c.title}\n`);
    }
  } catch (err) {
    process.stdout.write(`drift check skipped (${err instanceof Error ? err.message : String(err)})\n`);
  }

  if (config.dryRun) {
    const tasks = planTasks(golden, config);
    process.stdout.write(`DRY RUN: ${tasks.length} reps (${golden.cases.length} cases x ${config.runs} runs), concurrency ${config.concurrency}, flags ${JSON.stringify(config.flags)}\n`);
    return;
  }

  const resume = hasFlag(args, "--resume");
  const prior = resume ? readPartial() : [];
  if (!resume && fs.existsSync(PARTIAL_PATH)) fs.rmSync(PARTIAL_PATH);
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const done = new Set(prior.map((r) => `${r.testCaseId}#${r.rep}`));

  const fresh = await runBatch(client, golden, config, {
    skip: (id, rep) => done.has(`${id}#${rep}`),
    onRepDone: (r) => fs.appendFileSync(PARTIAL_PATH, `${JSON.stringify(r)}\n`),
  });

  const batchId = `gen-eval-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const report = buildReport(batchId, golden, config, [...prior, ...fresh]);
  const { jsonPath, mdPath } = writeReport(REPORTS_DIR, report);
  if (fs.existsSync(PARTIAL_PATH)) fs.rmSync(PARTIAL_PATH);

  process.stdout.write(`\n${renderMarkdown(report)}\n`);
  process.stdout.write(`Report: ${jsonPath}\n        ${mdPath}\n`);
}

function cmdReport (args: string[]): void {
  const id = flagValue(args, "--batch");
  let file: string;
  if (id) {
    file = path.join(REPORTS_DIR, `${id}.json`);
  } else {
    const jsons = fs.existsSync(REPORTS_DIR)
      ? fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith(".json")).sort()
      : [];
    if (jsons.length === 0) throw new Error(`no reports in ${REPORTS_DIR}`);
    file = path.join(REPORTS_DIR, jsons[jsons.length - 1]);
  }
  process.stdout.write(`${renderMarkdown(JSON.parse(fs.readFileSync(file, "utf8")))}\n`);
}

const USAGE = `studio-gen-eval — studio generation reliability eval

  import --project <id>                 cold-start golden-set.json from a project
  import                                list projects (then re-run with --project)
  run [--runs N] [--concurrency C] [--timeout S]
      [--flags k=v,k2=v2] [--cases id,id] [--dry-run] [--resume]
  report [--batch <id>]                 re-render a report (latest if omitted)
`;

async function main (): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd === "report") {
    cmdReport(args);
    return;
  }
  if (cmd === "import" || cmd === "run") {
    const client = createBackendClient();
    if (cmd === "import") await cmdImport(client, args);
    else await cmdRun(client, args);
    return;
  }
  process.stdout.write(USAGE);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
