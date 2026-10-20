import { describe, it, expect } from "vitest";
import { normalizeHookInput } from "../../guardrails/hookInput.js";

describe("normalizeHookInput", () => {
  // Codex reports a shell call's result as the bare output string.
  it("turns a string tool response into the combined-output field the detectors read", () => {
    expect(
      normalizeHookInput({ tool_name: "Bash", tool_response: "https://github.com/o/r/pull/7\n" }),
    ).toEqual({ tool_name: "Bash", tool_response: { output: "https://github.com/o/r/pull/7\n" } });
  });

  it("leaves a structured tool response as the host sent it", () => {
    const payload = { tool_name: "Bash", tool_response: { stdout: "ok", stderr: "" } };
    expect(normalizeHookInput(payload)).toEqual(payload);
  });

  it("treats anything that is not a JSON object as no payload", () => {
    expect(normalizeHookInput(null)).toEqual({});
    expect(normalizeHookInput("text")).toEqual({});
    expect(normalizeHookInput([1, 2])).toEqual({});
  });
});
