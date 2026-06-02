import type { HookInput } from "./types";

const PR_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/;
const CREATE_CMD = /\bgh\s+pr\s+(create|ready)\b/;

export function detectPrOpened(input: HookInput): string | null {
  if (input.tool_name !== "Bash") return null;
  const cmd = input.tool_input?.command ?? "";
  if (!CREATE_CMD.test(cmd)) return null;
  const out = `${input.tool_response?.stdout ?? ""}\n${input.tool_response?.output ?? ""}`;
  const m = out.match(PR_URL);
  return m ? m[0] : null;
}
