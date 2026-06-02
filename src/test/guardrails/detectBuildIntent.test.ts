import { describe, it, expect } from "vitest";
import { detectBuildIntent } from "../../guardrails/detectBuildIntent";

describe("detectBuildIntent", () => {
  it("matches build/implement/fix asks", () => {
    expect(detectBuildIntent("implement a dark-mode toggle")).toBe(true);
    expect(detectBuildIntent("can you build the export feature")).toBe(true);
    expect(detectBuildIntent("fix the null crash in the parser")).toBe(true);
    expect(detectBuildIntent("add a retry to the upload")).toBe(true);
  });
  it("ignores questions and non-build asks", () => {
    expect(detectBuildIntent("why does the failed job have no screenshots?")).toBe(false);
    expect(detectBuildIntent("what is next")).toBe(false);
    expect(detectBuildIntent("explain how auth works")).toBe(false);
  });
  it("ignores slash commands (already routed)", () => {
    expect(detectBuildIntent("/muggle-do address reviews 1 on https://github.com/o/r/pull/2")).toBe(false);
  });
});
