import { describe, it, expect } from "vitest";
import { envelope, blockStop, denyTool } from "../../guardrails/emit";

describe("envelope", () => {
  it("wraps context as Claude hookSpecificOutput", () => {
    const out = JSON.parse(envelope("PostToolUse", 'hello "world"\nline2', "claude"));
    expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(out.hookSpecificOutput.additionalContext).toBe('hello "world"\nline2');
  });

  it("wraps context as Cursor additional_context", () => {
    const out = JSON.parse(envelope("PostToolUse", "x", "cursor"));
    expect(out.additional_context).toBe("x");
  });

  it("emits an empty object when context is empty", () => {
    expect(envelope("PostToolUse", "", "claude")).toBe("{}");
  });
});

describe("blockStop", () => {
  it("emits a Claude Stop block decision", () => {
    const out = JSON.parse(blockStop("run E2E first", "claude"));
    expect(out.decision).toBe("block");
    expect(out.reason).toBe("run E2E first");
  });
  it("degrades to a Cursor advisory (no block primitive)", () => {
    const out = JSON.parse(blockStop("run E2E first", "cursor"));
    expect(out.decision).toBeUndefined();
    expect(out.additional_context).toBe("run E2E first");
  });
  it("emits an empty object when reason is empty", () => {
    expect(blockStop("", "claude")).toBe("{}");
  });
});

describe("denyTool", () => {
  it("emits a Claude PreToolUse deny", () => {
    const out = JSON.parse(denyTool("use the CLI", "claude"));
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe("use the CLI");
  });
  it("degrades to a Cursor advisory", () => {
    const out = JSON.parse(denyTool("use the CLI", "cursor"));
    expect(out.additional_context).toBe("use the CLI");
  });
  it("emits an empty object when reason is empty", () => {
    expect(denyTool("", "claude")).toBe("{}");
  });
});
