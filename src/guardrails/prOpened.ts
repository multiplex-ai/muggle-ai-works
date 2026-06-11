import type { HookInput } from "./types.js";

const PR_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/;
const MR_URL = /https?:\/\/[^/\s]+\/[^\s]+\/-\/merge_requests\/\d+/;
const CREATE_CMD = /\bgh\s+pr\s+(create|ready)\b/;
const MR_CREATE_CMD = /\bglab\s+mr\s+create\b|\bglab\s+mr\s+update\b.*--ready\b/;

export function detectPrOpened(input: HookInput): string | null {
  if (input.tool_name !== "Bash") return null;
  const cmd = input.tool_input?.command ?? "";
  if (!CREATE_CMD.test(cmd) && !MR_CREATE_CMD.test(cmd)) return null;
  const out = `${input.tool_response?.stdout ?? ""}\n${input.tool_response?.output ?? ""}`;
  const m = out.match(PR_URL) ?? out.match(MR_URL);
  return m ? m[0] : null;
}
