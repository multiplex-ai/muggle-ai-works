import { describe, it, expect } from "vitest";

import { resolveDisclosureCopy } from "../../cli/disclosure/disclosure-copy.js";

describe("first-run telemetry disclosure", () => {
  const copy = resolveDisclosureCopy();

  it("keeps the upstream description of what is collected", () => {
    expect(copy).toContain("anonymous usage telemetry");
  });

  it("does not point at a CLI command that was never registered", () => {
    expect(copy).not.toContain("muggle preferences set");
  });

  it("names both opt-out mechanisms the client actually honors", () => {
    expect(copy).toContain("MUGGLE_TELEMETRY_DISABLED=1");
    expect(copy).toContain("telemetryEnabled");
  });

  it("says where telemetryEnabled lives, since it is not a preference key", () => {
    expect(copy).toContain("top level of ~/.muggle-ai/preferences.json");
  });
});
