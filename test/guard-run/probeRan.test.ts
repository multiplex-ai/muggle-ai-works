import { describe, it, expect } from "vitest";
import { probeRan } from "../../src/guard-run/probeRan.js";

describe("probeRan", () => {
  // What spawnSync returns for `ps` inside Codex's Linux sandbox: an EPERM
  // error beside a clean exit and the full listing.
  it("trusts a probe that exited, whatever error the spawn reported alongside", () => {
    expect(probeRan({ status: 0, stdout: "  1\n  2\n" })).toBe(true);
  });

  it("still counts a non-zero exit as having run, for the caller to judge", () => {
    expect(probeRan({ status: 1, stdout: "offline\n" })).toBe(true);
  });

  it("rejects a probe that never started", () => {
    expect(probeRan({ status: null, stdout: "" })).toBe(false);
  });
});
