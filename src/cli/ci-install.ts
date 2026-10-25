/**
 * `muggle ci-install` CLI handler.
 *
 * Writes the walkthrough-check workflow into the current repository, so a PR
 * opened outside a Muggle session still has to settle its walkthrough comment,
 * and keeps a copy an earlier release wrote up to date.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { USER_WORKFLOW_PATH } from "../ci-workflow/constants.js";
import { classifyInstalledWorkflow } from "../ci-workflow/installed-workflow.js";
import { renderUserWorkflow } from "../ci-workflow/template.js";
import { InstalledWorkflowState } from "../ci-workflow/types.js";
import { CI_INSTALL_MESSAGES, WORKFLOW_WRITING_OUTCOMES } from "./ci-install-constants.js";
import {
  CiInstallOutcome,
  type CiInstallOptions,
  type CiInstallReport,
} from "./ci-install-types.js";

function resolveInstallOutcome(installedState: InstalledWorkflowState, force: boolean): CiInstallOutcome {
  switch (installedState) {
    case InstalledWorkflowState.Missing:
      return CiInstallOutcome.Installed;
    case InstalledWorkflowState.Outdated:
      return CiInstallOutcome.Updated;
    case InstalledWorkflowState.Current:
      return CiInstallOutcome.AlreadyCurrent;
    case InstalledWorkflowState.Customized:
      return force ? CiInstallOutcome.Replaced : CiInstallOutcome.KeptCustomized;
  }
}

/**
 * Place the current workflow in a repository.
 *
 * Replaces a copy only when an earlier release wrote it and nobody has edited
 * it since. An edited copy is the consumer's, and is overwritten only with
 * `force`: a scaffolder that silently reverts their changes is worse than one
 * that does nothing.
 */
export function installCiWorkflow(options: CiInstallOptions): CiInstallReport {
  const workflowPath = join(options.cwd, USER_WORKFLOW_PATH);
  if (!existsSync(join(options.cwd, ".git"))) {
    return { outcome: CiInstallOutcome.NotARepository, workflowPath: workflowPath };
  }
  const installedContent = existsSync(workflowPath) ? readFileSync(workflowPath, "utf-8") : null;
  const outcome = resolveInstallOutcome(classifyInstalledWorkflow(installedContent), options.force);
  if (WORKFLOW_WRITING_OUTCOMES.has(outcome)) {
    mkdirSync(dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, renderUserWorkflow());
  }
  return { outcome: outcome, workflowPath: workflowPath };
}

/**
 * Install or update the workflow in the working directory.
 *
 * @param flags - `--force` to replace a workflow the consumer edited.
 */
export function ciInstallCommand(flags: { force?: boolean }): void {
  const report = installCiWorkflow({ cwd: process.cwd(), force: flags.force === true });
  const render = CI_INSTALL_MESSAGES[report.outcome];
  process.stdout.write(`${render(report.workflowPath)}\n`);
  if (report.outcome === CiInstallOutcome.NotARepository) process.exitCode = 1;
}
