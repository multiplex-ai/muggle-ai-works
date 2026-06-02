import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync } from "fs";
import { readState, markPrHandled, isPrHandled } from "../../guardrails/sessionState";

describe("sessionState", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gr-"));
  });

  it("returns empty state for an unknown session", () => {
    expect(readState("s1", dir)).toEqual({ sessionId: "s1", prsHandled: [] });
  });

  it("marks a PR handled and is idempotent", () => {
    markPrHandled("s1", "https://github.com/o/r/pull/7", dir);
    expect(isPrHandled("s1", "https://github.com/o/r/pull/7", dir)).toBe(true);
    markPrHandled("s1", "https://github.com/o/r/pull/7", dir);
    expect(readState("s1", dir).prsHandled).toEqual(["https://github.com/o/r/pull/7"]);
  });

  it("isolates state per session id", () => {
    markPrHandled("s1", "https://github.com/o/r/pull/7", dir);
    expect(isPrHandled("s2", "https://github.com/o/r/pull/7", dir)).toBe(false);
  });
});
