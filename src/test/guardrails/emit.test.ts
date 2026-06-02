import { describe, it, expect } from "vitest";
import { envelope } from "../../guardrails/emit";

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
