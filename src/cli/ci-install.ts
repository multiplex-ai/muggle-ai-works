/**
 * `muggle ci-install` CLI handler.
 *
 * Writes the walkthrough-check workflow into the current repository, so a PR
 * opened outside a Muggle session still has to settle its walkthrough comment.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { USER_WORKFLOW_PATH } from "../ci-workflow/constants.js";
import { renderUserWorkflow } from "../ci-workflow/template.js";
import {
  CiInstallOutcome,
  type CiInstallOptions,
  type CiInstallReport,
} from "./ci-install-types.js";

/**
 * Place the workflow in a repository.
 *
 * Never overwrites without `force`: the file is the consumer's to edit once it
 * lands, and a scaffolder that silently reverts their changes is worse than one
 * that does nothing.
 */
export function installCiWorkflow(options: CiInstallOptions): CiInstallReport {
  const workflowPath = join(options.cwd, USER_WORKFLOW_PATH);
  if (!existsSync(join(options.cwd, ".git"))) {
    return { outcome: CiInstallOutcome.NotARepository, workflowPath: workflowPath };
  }
  if (existsSync(workflowPath) && !options.force) {
    return { outcome: CiInstallOutcome.AlreadyPresent, workflowPath: workflowPath };
  }
  mkdirSync(dirname(workflowPath), { recursive: true });
  writeFileSync(workflowPath, renderUserWorkflow());
  return { outcome: CiInstallOutcome.Installed, workflowPath: workflowPath };
}

const MESSAGES: Record<CiInstallOutcome, (path: string) => string> = {
  [CiInstallOutcome.Installed]: (path) =>
    `Wrote ${path}\nCommit it, and every pull request here will owe a settled Muggle AI walkthrough comment.`,
  [CiInstallOutcome.AlreadyPresent]: (path) =>
    `${path} already exists — left untouched. Re-run with --force to replace it.`,
  [CiInstallOutcome.NotARepository]: () =>
    "Not a git repository — run this from the repo that should carry the check.",
};

/**
 * Install the workflow into the working directory.
 *
 * @param flags - `--force` to replace an existing workflow.
 */
export function ciInstallCommand(flags: { force?: boolean }): void {
  const report = installCiWorkflow({ cwd: process.cwd(), force: flags.force === true });
  const render = MESSAGES[report.outcome];
  process.stdout.write(`${render(report.workflowPath)}\n`);
  if (report.outcome === CiInstallOutcome.NotARepository) process.exitCode = 1;
}
