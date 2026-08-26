import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

// The timeout is the only thing standing between this suite and the flake it
// was raised for, and nothing else would notice if it were dropped: a shorter
// ceiling fails intermittently, on a different file each time, and only under
// parallel load. That reads as "flaky tests" rather than "someone changed the
// config", so pin it here where the reason is written down.
const CONFIG = fileURLToPath(new URL("../../vitest.config.ts", import.meta.url));

const VITEST_DEFAULT_TIMEOUT_MS = 5_000;

describe("vitest config", () => {
  const configBody = readFileSync(CONFIG, "utf-8");

  it("declares a test timeout above vitest's default", () => {
    const declared = configBody.match(/const SPAWN_HEAVY_TIMEOUT_MS = ([\d_]+);/)?.[1];
    expect(declared, "SPAWN_HEAVY_TIMEOUT_MS is no longer declared").toBeDefined();
    expect(Number(declared!.replaceAll("_", ""))).toBeGreaterThan(VITEST_DEFAULT_TIMEOUT_MS);
  });

  it("applies it to both tests and hooks", () => {
    expect(configBody).toContain("testTimeout: SPAWN_HEAVY_TIMEOUT_MS");
    expect(configBody).toContain("hookTimeout: SPAWN_HEAVY_TIMEOUT_MS");
  });
});
