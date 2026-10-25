import { CiInstallOutcome } from "./ci-install-types.js";

/** The outcomes that write the current rendering into the repository. */
export const WORKFLOW_WRITING_OUTCOMES: ReadonlySet<CiInstallOutcome> = new Set([
  CiInstallOutcome.Installed,
  CiInstallOutcome.Updated,
  CiInstallOutcome.Replaced,
]);

/** What `muggle ci-install` prints for each outcome, given the workflow's path. */
export const CI_INSTALL_MESSAGES: Record<CiInstallOutcome, (path: string) => string> = {
  [CiInstallOutcome.Installed]: (path) =>
    `Wrote ${path}\nCommit it, and every pull request here will owe a settled Muggle AI walkthrough comment.`,
  [CiInstallOutcome.Updated]: (path) =>
    `Updated ${path} from an earlier Muggle release to the current workflow. Commit it.`,
  [CiInstallOutcome.AlreadyCurrent]: (path) => `${path} is already the current workflow — nothing to do.`,
  [CiInstallOutcome.KeptCustomized]: (path) =>
    `${path} has been edited since Muggle wrote it — left untouched. Re-run with --force to replace it.`,
  [CiInstallOutcome.Replaced]: (path) => `Replaced ${path} with the current workflow. Commit it.`,
  [CiInstallOutcome.NotARepository]: () =>
    "Not a git repository — run this from the repo that should carry the check.",
};
