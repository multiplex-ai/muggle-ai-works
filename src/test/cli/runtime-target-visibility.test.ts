import { afterEach, describe, expect, it, vi } from "vitest";

import { resetConfig } from "../../../packages/mcps/src/shared/config.js";
import { RUNTIME_TARGET_ENV_VAR } from "../../../packages/mcps/src/shared/runtime-target-constants.js";
import { loginCommand, statusCommand } from "../../cli/login.js";

afterEach(() => {
  delete process.env[RUNTIME_TARGET_ENV_VAR];
  resetConfig();
  vi.restoreAllMocks();
});

/**
 * Capture everything statusCommand prints.
 * @returns The joined console output.
 */
async function captureStatusOutput(): Promise<string> {
  // Importing the CLI resolves config once at module load, before any test has
  // set a target; without this the cached instance outlives the env change.
  resetConfig();

  const printedLines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    printedLines.push(String(line));
  });

  await statusCommand();

  return printedLines.join("\n");
}

describe("statusCommand", () => {
  it("reports the active runtime target and backend for production", async () => {
    process.env[RUNTIME_TARGET_ENV_VAR] = "production";

    const printedOutput = await captureStatusOutput();

    expect(printedOutput).toContain("Runtime target: production");
    expect(printedOutput).toContain("https://promptservice.muggle-ai.com");
  });

  it("reports the staging backend on a staging build", async () => {
    process.env[RUNTIME_TARGET_ENV_VAR] = "staging";

    const printedOutput = await captureStatusOutput();

    expect(printedOutput).toContain("Runtime target: staging");
    expect(printedOutput).toContain("https://staging.promptservice.muggle-ai.com");
  });
});

describe("loginCommand", () => {
  it("refuses a target with no provisioned device code client", async () => {
    process.env[RUNTIME_TARGET_ENV_VAR] = "staging";
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(loginCommand({})).rejects.toThrow(/no Auth0 device code client/);
  });
});
