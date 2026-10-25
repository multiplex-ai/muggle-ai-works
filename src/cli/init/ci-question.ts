import { existsSync } from "fs";
import { join } from "path";
import { PreferenceValue } from "../../../packages/mcps/src/index.js";
import { USER_WORKFLOW_PATH } from "../../ci-workflow/constants.js";
import { installCiWorkflow } from "../ci-install.js";
import { CiInstallOutcome } from "../ci-install-types.js";
import { CiOfferOutcome, type AskQuestion } from "./ci-question-types.js";

const QUESTION =
  "Make E2E acceptance a CI check in this repo? It adds a GitHub Actions workflow that fails a pull request\n" +
  "whose Muggle walkthrough is missing or reports a failed test. [y/N]: ";

// The repository already consented to the workflow when it was installed, so
// refreshing an unedited copy from an earlier release asks nothing; an edited
// copy is the consumer's and stays as it is.
function keepInstalledWorkflowCurrent(cwd: string): CiOfferOutcome {
  const report = installCiWorkflow({ cwd: cwd, force: false });
  return report.outcome === CiInstallOutcome.Updated ? CiOfferOutcome.Updated : CiOfferOutcome.AlreadyInstalled;
}

/**
 * Act on the `autoInstallCiWorkflow` preference in the repository init ran in.
 *
 * Only asks where the answer can be acted on — inside a repository that does
 * not already carry the workflow — because a question whose yes does nothing
 * teaches people to stop reading the prompts. `always` installs, `never` stays
 * silent, and `ask` asks when a terminal can answer, else defers. Where the
 * workflow exists, any value but `never` refreshes an unedited earlier copy.
 *
 * A bare Enter declines: this writes a file into the user's repository, and
 * silence is not consent to do that.
 *
 * @param preference - The resolved `autoInstallCiWorkflow` value.
 * @param ask - Prompts the user; `null` on a surface with nobody to answer.
 */
export async function applyCiWorkflowPreference(
  preference: PreferenceValue,
  cwd: string,
  ask: AskQuestion | null,
): Promise<CiOfferOutcome> {
  if (!existsSync(join(cwd, ".git"))) return CiOfferOutcome.NotApplicable;
  if (preference === PreferenceValue.Never) return CiOfferOutcome.TurnedOff;
  if (existsSync(join(cwd, USER_WORKFLOW_PATH))) return keepInstalledWorkflowCurrent(cwd);

  if (preference !== PreferenceValue.Always) {
    if (!ask) return CiOfferOutcome.Deferred;
    const answer = (await ask(QUESTION)).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") return CiOfferOutcome.Declined;
  }

  installCiWorkflow({ cwd: cwd, force: false });
  return CiOfferOutcome.Installed;
}
