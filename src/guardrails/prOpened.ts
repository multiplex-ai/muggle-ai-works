import { GITHUB_PR_URL, GITLAB_MR_URL } from "./constants.js";
import { isShellToolCall } from "./shellTool.js";
import type { HookInput } from "./types.js";

const CREATE_CMD = /\bgh\s+pr\s+(create|ready)\b/;
const MR_CREATE_CMD = /\bglab\s+mr\s+create\b|\bglab\s+mr\s+update\b.*--ready\b/;

export function detectPrOpened(input: HookInput): string | null {
  if (!isShellToolCall(input)) return null;
  const cmd = input.tool_input?.command ?? "";
  if (!CREATE_CMD.test(cmd) && !MR_CREATE_CMD.test(cmd)) return null;
  const out = `${input.tool_response?.stdout ?? ""}\n${input.tool_response?.output ?? ""}`;
  const m = out.match(GITHUB_PR_URL) ?? out.match(GITLAB_MR_URL);
  return m ? m[0] : null;
}
