import { describe, it, expect } from "vitest";
import { windowsCommandNeedsCmdShell } from "../../src/guard-run/resolveWindowsCommand.js";

// npm writes an extensionless POSIX shim beside every .cmd, and `where.exe`
// lists it first.
const NPM_SHIM_WHERE_OUTPUT = "C:\\Users\\u\\AppData\\Roaming\\npm\\pnpm\r\nC:\\Users\\u\\AppData\\Roaming\\npm\\pnpm.cmd\r\n";

describe("windowsCommandNeedsCmdShell", () => {
  it("runs an npm tool through cmd.exe even though its POSIX shim is listed first", () => {
    expect(windowsCommandNeedsCmdShell({ firstCommandToken: "pnpm", whereOutput: NPM_SHIM_WHERE_OUTPUT })).toBe(true);
  });

  it("launches an executable directly", () => {
    expect(
      windowsCommandNeedsCmdShell({ firstCommandToken: "node", whereOutput: "C:\\Program Files\\nodejs\\node.exe\r\n" }),
    ).toBe(false);
  });

  it("takes an explicit script extension at its word without a lookup", () => {
    expect(windowsCommandNeedsCmdShell({ firstCommandToken: "pnpm.cmd", whereOutput: null })).toBe(true);
    expect(windowsCommandNeedsCmdShell({ firstCommandToken: "build.BAT", whereOutput: null })).toBe(true);
    expect(windowsCommandNeedsCmdShell({ firstCommandToken: "node.exe", whereOutput: null })).toBe(false);
  });

  it("leaves an unresolvable command to CreateProcess, which reports it", () => {
    expect(windowsCommandNeedsCmdShell({ firstCommandToken: "missing", whereOutput: null })).toBe(false);
    expect(
      windowsCommandNeedsCmdShell({ firstCommandToken: "pnpm", whereOutput: "C:\\Users\\u\\AppData\\Roaming\\npm\\pnpm\r\n" }),
    ).toBe(false);
  });
});
