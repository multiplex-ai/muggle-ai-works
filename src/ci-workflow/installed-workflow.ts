import { createHash } from "crypto";
import { PRIOR_USER_WORKFLOW_SHA256S, USER_WORKFLOW_SHA256 } from "./constants.js";
import { InstalledWorkflowState } from "./types.js";

/**
 * SHA-256 of a walkthrough workflow with its line endings normalized to LF, so
 * a checkout that rewrote them still matches the rendering it came from.
 *
 * @param workflowContent - The workflow file's text.
 * @returns The hex digest.
 */
export function hashUserWorkflow(workflowContent: string): string {
  return createHash("sha256").update(workflowContent.replace(/\r\n/g, "\n")).digest("hex");
}

/**
 * Place an installed walkthrough workflow against the renderings Muggle has shipped.
 *
 * @param workflowContent - The installed file's text, or `null` when the repository has none.
 * @returns Whether the workflow is missing, current, an unedited earlier rendering, or the consumer's own.
 */
export function classifyInstalledWorkflow(workflowContent: string | null): InstalledWorkflowState {
  if (workflowContent === null) return InstalledWorkflowState.Missing;
  const workflowHash = hashUserWorkflow(workflowContent);
  if (workflowHash === USER_WORKFLOW_SHA256) return InstalledWorkflowState.Current;
  if (PRIOR_USER_WORKFLOW_SHA256S.has(workflowHash)) return InstalledWorkflowState.Outdated;
  return InstalledWorkflowState.Customized;
}
