import { existsSync } from "fs";
import { join } from "path";
import { USER_WORKFLOW_PATH } from "../../ci-workflow/constants.js";
import { installCiWorkflow } from "../ci-install.js";
import { CiOfferOutcome, type AskQuestion } from "./ci-question-types.js";

const QUESTION =
  "Make E2E acceptance a CI check in this repo? It adds a GitHub Actions workflow so pull requests\n" +
  "opened outside Claude still have to carry a Muggle walkthrough comment. [y/N]: ";

/**
 * Offer the CI check at the end of the first-run walkthrough.
 *
 * Only asked where the answer can be acted on — inside a repository that does
 * not already carry the workflow — because a question whose yes does nothing
 * teaches people to stop reading the prompts.
 *
 * A bare Enter declines: this writes a file into the user's repository, and
 * silence is not consent to do that.
 */
export async function offerCiWorkflow(ask: AskQuestion, cwd: string): Promise<CiOfferOutcome> {
  if (!existsSync(join(cwd, ".git"))) return CiOfferOutcome.NotApplicable;
  if (existsSync(join(cwd, USER_WORKFLOW_PATH))) return CiOfferOutcome.AlreadyInstalled;

  const answer = (await ask(QUESTION)).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") return CiOfferOutcome.Declined;

  installCiWorkflow({ cwd: cwd, force: false });
  return CiOfferOutcome.Installed;
}
