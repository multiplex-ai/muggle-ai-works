import type { HookInput } from "./types.js";

const TEST_CMD = /\b(pnpm|npm|yarn)\s+(run\s+)?test\b|\b(jest|vitest|pytest)\b|\bgo\s+test\b|\bcargo\s+test\b/;
const FAIL = /\b\d+\s+failed\b|\bFAIL\b|✗/;

// A real acceptance run reaches the hook only as a muggle execute/replay MCP
// tool call — there is no `muggle test`/`muggle replay` CLI. Match the tool name,
// never the Bash command text: in a repo named "muggle", commits, PR titles and
// greps say "muggle … test" constantly, so a command-text match flips e2eRun=true
// before any run happens and disarms the Stop gate (even the unit-test command,
// `cd …/muggle-ai-works && npm test`, both armed and disarmed it in one call).
const E2E_TOOL = /muggle.*(execute|test-generation|replay)/i;

// A deliberate "E2E can't run here" declaration: the model runs
// `echo "MUGGLE_E2E_SKIP: <reason>"` and the Stop gate stays quiet for the
// session. Anchored to a leading `echo` for the same reason E2E_TOOL matches
// tool names, not command text — a grep, commit message, or skill edit that
// merely *mentions* the token must not disarm the gate.
const E2E_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_E2E_SKIP\b/;

export function isTestCommand(cmd: string): boolean {
  return TEST_CMD.test(cmd);
}

export function isE2ESkipMarker(cmd: string): boolean {
  return E2E_SKIP_MARKER.test(cmd);
}

export function testsPassed(input: HookInput): boolean {
  const out = `${input.tool_response?.stdout ?? ""}\n${input.tool_response?.stderr ?? ""}`;
  if (!out.trim()) return false;
  return !FAIL.test(out);
}

export function isE2ERun(input: HookInput): boolean {
  return E2E_TOOL.test(input.tool_name ?? "");
}
