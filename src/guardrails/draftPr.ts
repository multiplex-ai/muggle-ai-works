import {
  DRAFT_FLAG,
  GITHUB_CONVERT_TO_DRAFT_MUTATION,
  GITHUB_PR_CREATE_CMD,
  GITHUB_PR_READY_CMD,
  GITHUB_REST_DRAFT_FIELD,
  GITLAB_DRAFT_TITLE,
  GITLAB_MR_CREATE_OR_UPDATE_CMD,
  GITLAB_WIP_FLAG,
  PROVIDER_API_INVOCATION,
  UNDO_FLAG,
} from "./constants.js";
import { isShellToolCall } from "./shellTool.js";
import type { HookInput } from "./types.js";

/** A draft-PR gate verdict: whether to deny the tool call, and the instruction handed back to the model when denied. */
export interface DraftPrResult {
  deny: boolean;
  reason?: string;
}

const QUOTED_STRING = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
const COMMAND_SEPARATOR = /&&|\|\||[;|\n]/;

/**
 * The command with every quoted string blanked to `""`, split into its chained commands.
 *
 * Blanking first keeps a title or body that mentions `--draft` from reading as the flag,
 * and keeps a separator inside a quoted body from splitting a command in two.
 */
function unquotedSegments(command: string): string[] {
  return command.replace(QUOTED_STRING, '""').split(COMMAND_SEPARATOR);
}

/**
 * Whether this command opens a PR/MR as a draft or turns an open one back into a draft.
 *
 * Covers `gh pr create --draft|-d`, `gh pr ready --undo`, `glab mr create|update --draft|--wip`,
 * a GitLab draft title prefix, GitHub's `convertPullRequestToDraft` mutation, and a REST
 * `pulls` call carrying `draft=true`. Reads, greps and docs that only name these stay allowed.
 */
export function detectDraftPrCommand(command: string): boolean {
  for (const segment of unquotedSegments(command)) {
    if (GITHUB_PR_CREATE_CMD.test(segment) && DRAFT_FLAG.test(segment)) return true;
    if (GITHUB_PR_READY_CMD.test(segment) && UNDO_FLAG.test(segment)) return true;
    if (
      GITLAB_MR_CREATE_OR_UPDATE_CMD.test(segment) &&
      (DRAFT_FLAG.test(segment) || GITLAB_WIP_FLAG.test(segment))
    ) {
      return true;
    }
  }
  if (GITLAB_DRAFT_TITLE.test(command)) return true;
  if (PROVIDER_API_INVOCATION.test(command) && GITHUB_CONVERT_TO_DRAFT_MUTATION.test(command)) return true;
  return GITHUB_REST_DRAFT_FIELD.test(command);
}

const DRAFT_DENIAL =
  "Blocked: Muggle never opens draft PRs/MRs. Every PR goes up ready for review, so reviewers " +
  "and CI start on it as soon as it opens. Re-run the command without `--draft`/`-d`/`--wip` (and " +
  "without a `Draft:`/`WIP:` title prefix on GitLab). If the change is not ready for review, " +
  "don't open the PR yet; if a draft already exists, mark it ready with `gh pr ready <n>` " +
  "(GitLab: `glab mr update <n> --ready`).";

/** Deny any shell command that opens a draft PR/MR or converts an open one to draft, on either provider. */
export function evaluateDraftPr(input: HookInput): DraftPrResult {
  if (!isShellToolCall(input)) return { deny: false };
  if (!detectDraftPrCommand(input.tool_input?.command ?? "")) return { deny: false };
  return { deny: true, reason: DRAFT_DENIAL };
}
