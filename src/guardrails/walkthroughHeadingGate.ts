import { WALKTHROUGH_COMMENT_HEADING, WALKTHROUGH_SLOT_MARKER } from "../pr-walkthrough/constants.js";
import { collectPrPostText, defaultFileReader, isPrReportPostCommand, type FileReader } from "./prReportPost.js";
import { isShellToolCall } from "./shellTool.js";
import type { GuardrailState, HookInput } from "./types.js";

export interface HeadingGateResult {
  deny: boolean;
  reason?: string;
}

/**
 * Deny a PR post that wears the Muggle walkthrough identity when no acceptance
 * run happened this session.
 *
 * The heading and the slot marker are Muggle's name on a result. The report
 * gate already catches a hand-written *report*, but a comment can claim the
 * heading while carrying no report structure at all — describing what some
 * other tool checked — and that is the shape that put Muggle's name on a run it
 * never did. Supplemental proof from another tool is welcome on a PR; it just
 * may not wear this heading.
 */
export function evaluateWalkthroughHeadingPost(
  input: HookInput,
  state: GuardrailState,
  read: FileReader = defaultFileReader,
): HeadingGateResult {
  if (!isShellToolCall(input)) return { deny: false };
  if (state.e2eRun === true) return { deny: false };
  const cmd = input.tool_input?.command ?? "";
  if (!isPrReportPostCommand(cmd)) return { deny: false };
  const text = collectPrPostText(cmd, input.cwd, read);
  // The renderer's own sentinel is deliberately not an identity claim here: a
  // watcher may legitimately re-post a run's output in a later session that has
  // no run of its own, and denying that would block real evidence.
  const claimsIdentity =
    text.includes(WALKTHROUGH_COMMENT_HEADING) || text.includes(WALKTHROUGH_SLOT_MARKER);
  if (!claimsIdentity) return { deny: false };
  return {
    deny: true,
    reason:
      "Blocked: this comment carries the Muggle walkthrough heading, but no Muggle acceptance run has " +
      "been recorded this session. That slot is settled by Muggle itself — either from a real run, or " +
      "from a verified skip code via `echo \"MUGGLE_E2E_SKIP: <CODE>: <detail>\"`. If you verified this " +
      "change some other way, post that as its own comment without the Muggle heading, slot marker, or " +
      "report sentinel.",
  };
}
