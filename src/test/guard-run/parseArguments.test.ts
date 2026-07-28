import { describe, it, expect } from "vitest";
import { GUARD_RUN_DEFAULT_ACTIVE_PROCESS_LIMIT } from "../../guard-run/constants.js";
import { parseGuardRunArguments } from "../../guard-run/parseArguments.js";

describe("parseGuardRunArguments", () => {
  it("parses flags, separator, and command", () => {
    const result = parseGuardRunArguments(["--limit", "10", "--service", "--", "node", "app.js"]);
    expect(result.errorMessage).toBeNull();
    expect(result.options).toEqual({
      activeProcessLimit: 10,
      isServiceMode: true,
      command: ["node", "app.js"],
    });
  });

  it("defaults to limit 64, non-service", () => {
    const result = parseGuardRunArguments(["--", "npm", "test"]);
    expect(result.options).toEqual({
      activeProcessLimit: GUARD_RUN_DEFAULT_ACTIVE_PROCESS_LIMIT,
      isServiceMode: false,
      command: ["npm", "test"],
    });
    expect(GUARD_RUN_DEFAULT_ACTIVE_PROCESS_LIMIT).toBe(64);
  });

  it("accepts --limit=N form", () => {
    const result = parseGuardRunArguments(["--limit=5", "--", "true"]);
    expect(result.options?.activeProcessLimit).toBe(5);
  });

  it("starts the command at the first non-flag token without --", () => {
    const result = parseGuardRunArguments(["--limit", "8", "pnpm", "test"]);
    expect(result.options?.command).toEqual(["pnpm", "test"]);
  });

  it("leaves the command's own flags untouched after --", () => {
    const result = parseGuardRunArguments(["--", "vitest", "run", "--limit", "3", "--service"]);
    expect(result.options).toEqual({
      activeProcessLimit: GUARD_RUN_DEFAULT_ACTIVE_PROCESS_LIMIT,
      isServiceMode: false,
      command: ["vitest", "run", "--limit", "3", "--service"],
    });
  });

  it.each([["0"], ["-3"], ["abc"], ["1.5"]])("rejects --limit %s", (rawLimit) => {
    const result = parseGuardRunArguments(["--limit", rawLimit, "--", "true"]);
    expect(result.options).toBeNull();
    expect(result.errorMessage).toContain("--limit requires a positive integer");
  });

  it("rejects a missing --limit value", () => {
    const result = parseGuardRunArguments(["--limit"]);
    expect(result.options).toBeNull();
  });

  it("rejects an unknown flag instead of treating it as the command", () => {
    const result = parseGuardRunArguments(["--serivce", "--", "node", "app.js"]);
    expect(result.options).toBeNull();
    expect(result.errorMessage).toContain("unknown flag: --serivce");
  });

  it("rejects an empty command", () => {
    expect(parseGuardRunArguments([]).options).toBeNull();
    expect(parseGuardRunArguments(["--service", "--"]).options).toBeNull();
    expect(parseGuardRunArguments(["--service", "--"]).errorMessage).toContain("no command given");
  });
});
