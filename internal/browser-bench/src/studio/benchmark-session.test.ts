import { describe, expect, it } from "vitest";

import { BENCHMARK_SESSION_ENV_VAR } from "./constants";
import { resolveBenchmarkSessionPath } from "./benchmark-session";

describe("resolveBenchmarkSessionPath", () => {
  it("uses the benchmark identity the environment names", () => {
    expect(
      resolveBenchmarkSessionPath({ [BENCHMARK_SESSION_ENV_VAR]: "C:/creds/bench.json" }),
    ).toBe("C:/creds/bench.json");
  });

  it("refuses to fall back to whoever happens to be logged in", () => {
    // With no projectId and no organizationId, metering bills the executing
    // user's personal wallet — so an unset benchmark identity silently charges
    // a real person for the batch.
    expect(() => resolveBenchmarkSessionPath({})).toThrow(/MUGGLE_BENCHMARK_SESSION/);
  });

  it("explains why it refuses, not just that it did", () => {
    expect(() => resolveBenchmarkSessionPath({})).toThrow(/wallet/i);
  });

  it("treats an empty value as unset", () => {
    expect(() => resolveBenchmarkSessionPath({ [BENCHMARK_SESSION_ENV_VAR]: "" })).toThrow(
      /MUGGLE_BENCHMARK_SESSION/,
    );
  });
});
