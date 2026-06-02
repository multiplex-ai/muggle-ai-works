import type { HookInput } from "./types.js";

const TEST_CMD = /\b(pnpm|npm|yarn)\s+(run\s+)?test\b|\b(jest|vitest|pytest)\b|\bgo\s+test\b|\bcargo\s+test\b/;
const FAIL = /\b\d+\s+failed\b|\bFAIL\b|✗/;
const E2E_RUN = /\bmuggle\b[^\n]*\b(execute|test)\b/i;

export function isTestCommand(cmd: string): boolean {
  return TEST_CMD.test(cmd);
}

export function testsPassed(input: HookInput): boolean {
  const out = `${input.tool_response?.stdout ?? ""}\n${input.tool_response?.stderr ?? ""}`;
  if (!out.trim()) return false;
  return !FAIL.test(out);
}

export function isE2ERun(input: HookInput): boolean {
  const cmd = input.tool_input?.command ?? "";
  const tool = input.tool_name ?? "";
  return E2E_RUN.test(cmd) || /muggle.*(execute|test-generation|replay)/i.test(tool);
}
