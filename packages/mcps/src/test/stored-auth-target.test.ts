import { describe, expect, it } from "vitest";

import { isStoredAuthForRuntimeTarget } from "../mcp/local/services/stored-auth-target.js";
import { RuntimeTarget } from "../shared/runtime-target-types.js";

describe("isStoredAuthForRuntimeTarget", () => {
  it("accepts a session recorded for the active target", () => {
    expect(
      isStoredAuthForRuntimeTarget({
        storedRuntimeTarget: RuntimeTarget.Staging,
        activeRuntimeTarget: RuntimeTarget.Staging,
      }),
    ).toBe(true);
  });

  // The production tenant's token is rejected by the staging backend with a
  // 401, so reporting it as an authenticated staging session describes a state
  // that cannot make a single successful call.
  it("rejects a production session while running as staging", () => {
    expect(
      isStoredAuthForRuntimeTarget({
        storedRuntimeTarget: RuntimeTarget.Production,
        activeRuntimeTarget: RuntimeTarget.Staging,
      }),
    ).toBe(false);
  });

  it("rejects a staging session while running as production", () => {
    expect(
      isStoredAuthForRuntimeTarget({
        storedRuntimeTarget: RuntimeTarget.Staging,
        activeRuntimeTarget: RuntimeTarget.Production,
      }),
    ).toBe(false);
  });

  it("accepts an unrecorded session as production, the only ring that could have written it", () => {
    expect(
      isStoredAuthForRuntimeTarget({
        storedRuntimeTarget: undefined,
        activeRuntimeTarget: RuntimeTarget.Production,
      }),
    ).toBe(true);
  });

  it("rejects an unrecorded session on every other ring", () => {
    expect(
      isStoredAuthForRuntimeTarget({
        storedRuntimeTarget: undefined,
        activeRuntimeTarget: RuntimeTarget.Staging,
      }),
    ).toBe(false);
  });
});
