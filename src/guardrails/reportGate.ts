import type { HookInput } from "./types.js";
import {
  REPORT_SENTINEL,
  collectPrPostText,
  defaultFileReader,
  isPrReportPostCommand,
  type FileReader,
} from "./prReportPost.js";

export interface ReportGateResult {
  deny: boolean;
  reason?: string;
}

// Does this text read like a rendered E2E acceptance report (vs an ordinary PR
// comment or a PR description that merely mentions E2E work)? Require a results
// *structure* — the walkthrough's heading, a pass/fail tally, or a per-test
// status list — AND a Muggle/E2E context. Keying on structure (not just the
// words "e2e"/"muggle") keeps plain comments and feature PR descriptions clear.
export function looksLikeE2EReport(text: string): boolean {
  const t = text.toLowerCase();
  const statusEmojis = (text.match(/[✅❌⚠]/gu) ?? []).length;
  const tally =
    /\b\d+\s+(tests?\s+)?passed\b/.test(t) &&
    /\b\d+\s+(tests?\s+)?(failed|inconclusive)\b/.test(t);
  const slashTally =
    /\bpassed\b\s*[/|]\s*\d*\s*(tests?\s*)?\bfailed\b/.test(t) ||
    /\bfailed\b\s*[/|]\s*\d*\s*(tests?\s*)?\bpassed\b/.test(t);
  const resultsStructure =
    /acceptance results/.test(t) || tally || slashTally || statusEmojis >= 2;
  const muggleContext =
    /\bmuggle\b/.test(t) || /muggle-ai\.com/.test(t) || /\be2e\b/.test(t) || /\bacceptance\b/.test(t);
  return resultsStructure && muggleContext;
}

// Gate a PR publish — a new comment/PR/description, or an edit to an existing
// comment. Deny only when the body the gate can actually see reads like an E2E
// report yet lacks the sentinel — i.e. a hand-written report. The sanctioned
// `jq … | gh … --body-file -` path either surfaces the sentinel (via the jq'd
// artifact) or is un-inspectable; both fail open, so legitimate posts are never
// blocked.
export function evaluateReportPost(
  input: HookInput,
  read: FileReader = defaultFileReader,
): ReportGateResult {
  if (input.tool_name !== "Bash") return { deny: false };
  const cmd = input.tool_input?.command ?? "";
  if (!isPrReportPostCommand(cmd)) return { deny: false };
  const text = collectPrPostText(cmd, input.cwd, read);
  if (text.includes(REPORT_SENTINEL)) return { deny: false };
  if (!looksLikeE2EReport(text)) return { deny: false };
  return {
    deny: true,
    reason:
      "Blocked: this looks like a hand-written E2E test report. Muggle requires the deterministic " +
      "renderer — build the run's E2eReport JSON and pipe it through `muggle build-pr-section` (or invoke " +
      "/muggle:muggle-pr-visual-walkthrough), then post that output. Never hand-write the walkthrough markdown.",
  };
}
