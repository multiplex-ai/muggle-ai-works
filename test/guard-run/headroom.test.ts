import { describe, it, expect } from "vitest";
import { GUARD_RUN_MIN_DEFAULT_ACTIVE_PROCESS_LIMIT } from "../../src/guard-run/constants.js";
import {
  computeDefaultActiveProcessLimit,
  computeNprocCeiling,
  countProcessListLines,
} from "../../src/guard-run/headroom.js";

describe("computeDefaultActiveProcessLimit", () => {
  it("never drops below the minimum on a small machine", () => {
    expect(computeDefaultActiveProcessLimit(1)).toBe(GUARD_RUN_MIN_DEFAULT_ACTIVE_PROCESS_LIMIT);
    expect(computeDefaultActiveProcessLimit(4)).toBe(GUARD_RUN_MIN_DEFAULT_ACTIVE_PROCESS_LIMIT);
  });

  it("grows with logical CPUs, since a test runner starts one worker per CPU", () => {
    // 24 CPUs: the works suite needs more than 64 and passes at 128.
    expect(computeDefaultActiveProcessLimit(24)).toBe(192);
  });

  it("stays far below the ~12,500-process storm the cap exists for", () => {
    expect(computeDefaultActiveProcessLimit(256)).toBeLessThan(12_500 / 4);
  });
});

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
