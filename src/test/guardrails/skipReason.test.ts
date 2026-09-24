import { describe, it, expect } from "vitest";
import { judgeE2eSkip } from "../../guardrails/skipReason";
import { E2eSkipCode, type SkipProbes } from "../../e2e-skip/types";
import type { GuardrailState, HookInput } from "../../guardrails/types";

const probes = (overrides: Partial<SkipProbes> = {}): SkipProbes => ({
  readTextFile: () => null,
  listFiles: () => [],
  runGit: () => null,
  isReachable: () => false,
  ...overrides,
});

const state = (overrides: Partial<GuardrailState> = {}): GuardrailState => ({
  sessionId: "s",
  prsHandled: [],
  ...overrides,
});

const declaring = (cmd: string): HookInput => ({ tool_name: "Bash", tool_input: { command: cmd }, cwd: "/repo" });

describe("judgeE2eSkip", () => {
  it("accepts a verified code", () => {
    const judged = judgeE2eSkip(
      declaring('echo "MUGGLE_E2E_SKIP: NO_PR: nothing was opened"'),
      state(),
      probes(),
    );
    expect(judged).toEqual({
      accepted: true,
      skip: { code: E2eSkipCode.NoPr, detail: "nothing was opened" },
    });
  });

  // The session's own PR list is what refutes the claim, which is why the
  // adapter feeds state into the verification rather than just the command.
  it("rejects a code the session's own state refutes", () => {
    const judged = judgeE2eSkip(
      declaring('echo "MUGGLE_E2E_SKIP: NO_PR"'),
      state({ prsHandled: ["https://github.com/o/r/pull/9"] }),
      probes(),
    );
    expect(judged?.accepted).toBe(false);
  });

  it("returns null for a command that is not a declaration", () => {
    expect(judgeE2eSkip(declaring("pnpm test"), state(), probes())).toBeNull();
  });
});
