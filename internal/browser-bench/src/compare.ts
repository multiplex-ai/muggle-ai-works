import * as fs from "node:fs";
import * as path from "node:path";

import { parseCompareArgs } from "./compare/compare-args";
import { NOT_ON_PAR_EXIT_CODE, SOURCE_PAR_REPORT_FILENAME } from "./compare/constants";
import { renderSourceParReport } from "./compare/render-par-report";
import { evaluateSourcePar } from "./compare/source-par";
import { PARTIAL_LOG_FILENAME } from "./domain/constants";
import { type TaskResult } from "./domain/types";
import { parsePartialLog } from "./partial-log/partial-log";

const readBatchResults = (batchDir: string): TaskResult[] =>
  parsePartialLog(fs.readFileSync(path.join(batchDir, PARTIAL_LOG_FILENAME), "utf8"));

const main = (): void => {
  const options = parseCompareArgs(process.argv.slice(2));
  const verdict = evaluateSourcePar({
    baselineResults: readBatchResults(options.baselineDir),
    candidateResults: readBatchResults(options.candidateDir),
  });

  const reportPath = path.join(options.candidateDir, SOURCE_PAR_REPORT_FILENAME);
  const report = renderSourceParReport(verdict);
  fs.writeFileSync(reportPath, `${report}\n`, "utf8");
  process.stdout.write(`${report}\n\nReport: ${reportPath}\n`);
  if (!verdict.isPar) process.exit(NOT_ON_PAR_EXIT_CODE);
};

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
