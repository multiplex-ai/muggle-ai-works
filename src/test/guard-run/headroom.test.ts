import { describe, it, expect } from "vitest";
import { computeNprocCeiling, countProcessListLines } from "../../guard-run/headroom.js";

describe("countProcessListLines", () => {
  it("counts one process per non-blank line", () => {
    expect(countProcessListLines("  101\n  102\n 4033\n")).toBe(3);
  });

  it("ignores blank and whitespace-only lines", () => {
    expect(countProcessListLines("101\n\n   \n102\n")).toBe(2);
  });

  it("is zero for empty output", () => {
    expect(countProcessListLines("")).toBe(0);
  });
});

describe("computeNprocCeiling", () => {
  it("adds the limit as headroom above the user's current count", () => {
    expect(computeNprocCeiling({ currentUserProcessCount: 420, activeProcessLimit: 64 })).toBe(484);
  });
});
