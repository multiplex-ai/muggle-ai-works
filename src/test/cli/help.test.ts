import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  getPostInstallGuidance,
  getHelpGuidance,
  helpCommand,
} from "../../cli/help.js";

const RESET = "\x1b[0m";

describe("help guidance", () => {
  const originalNoColor = process.env.NO_COLOR;

  afterEach(() => {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  });

  it("colorizes output when NO_COLOR is unset", () => {
    delete process.env.NO_COLOR;
    const out = getPostInstallGuidance();
    expect(out).toContain(RESET);
    expect(out).toContain("Installation Complete");
    expect(out).toContain("muggle help");
  });

  it("omits ANSI codes when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    const out = getHelpGuidance();
    expect(out).not.toContain("\x1b[");
    expect(out).toContain("Comprehensive How-To Guide");
    expect(out).toContain("~/.cursor/mcp.json");
    expect(out).toContain("muggle serve --local");
  });

  it("help guidance lists the core CLI commands", () => {
    process.env.NO_COLOR = "1";
    const out = getHelpGuidance();
    for (const cmd of ["muggle setup", "muggle doctor", "muggle upgrade", "muggle login", "muggle cleanup"]) {
      expect(out).toContain(cmd);
    }
  });
});

describe("helpCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("prints the full guidance", () => {
    helpCommand();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toContain("Comprehensive How-To Guide");
  });
});
