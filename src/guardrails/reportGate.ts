import { readFileSync, existsSync } from "fs";
import { isAbsolute, resolve } from "path";
import type { HookInput } from "./types.js";

// Substring present in every `muggle build-pr-section` rendering (see
// src/cli/build-pr-section.ts). Kept as a version-agnostic substring so the gate
// keeps recognising sanctioned output across `:v1` → `:v2` bumps.
export const REPORT_SENTINEL = "muggle-pr-section";

const PR_POST_CMD = /\bgh\s+pr\s+(comment|create|edit)\b/;

export interface ReportGateResult {
  deny: boolean;
  reason?: string;
}

export type FileReader = (path: string, cwd?: string) => string | null;

const defaultReader: FileReader = (path, cwd) => {
  try {
    const abs = isAbsolute(path) ? path : resolve(cwd ?? process.cwd(), path);
    if (!existsSync(abs)) return null;
    return readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
};

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
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

// Everything the gate can read of what a `gh pr` command will post: the command
// string itself (covers inline `--body`, `-b`, echo/heredoc/printf bodies) plus
// any readable `--body-file <path>` and any `.json` a `jq` pipe reads (the
// sanctioned build-pr-section artifact, whose {body,comment} carry the sentinel).
function collectInspectableText(cmd: string, cwd: string | undefined, read: FileReader): string {
  let text = cmd;
  for (const m of cmd.matchAll(/--body-file[=\s]+("[^"]+"|'[^']+'|\S+)/g)) {
    const p = unquote(m[1]);
    if (p && p !== "-") {
      const c = read(p, cwd);
      if (c) text += "\n" + c;
    }
  }
  for (const m of cmd.matchAll(/jq\b[^|]*?("[^"]+\.json"|'[^']+\.json'|\S+\.json)/g)) {
    const c = read(unquote(m[1]), cwd);
    if (c) text += "\n" + c;
  }
  return text;
}

// Gate a `gh pr comment|create|edit`. Deny only when the body the gate can
// actually see reads like an E2E report yet lacks the sentinel — i.e. a
// hand-written report. The sanctioned `jq … | gh … --body-file -` path either
// surfaces the sentinel (via the jq'd artifact) or is un-inspectable; both
// fail open, so legitimate posts are never blocked.
export function evaluateReportPost(input: HookInput, read: FileReader = defaultReader): ReportGateResult {
  if (input.tool_name !== "Bash") return { deny: false };
  const cmd = input.tool_input?.command ?? "";
  if (!PR_POST_CMD.test(cmd)) return { deny: false };
  const text = collectInspectableText(cmd, input.cwd, read);
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
