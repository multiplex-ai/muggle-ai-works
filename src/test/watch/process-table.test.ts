import { describe, expect, it } from "vitest";
import { parsePsElapsedSeconds, readProcessTable } from "../../watch/process-table.js";
import { scriptedRunner, succeeded } from "./fixtures.js";

const NOW_MS = 1_800_000_000_000;

describe("readProcessTable on Windows", () => {
  it("reads CIM rows through an encoded Windows PowerShell script", () => {
    const rows = [
      { p: 10, pp: 4, n: "claude", c: "claude.exe --resume x", s: NOW_MS - 60_000 },
      { p: 11, pp: 10, n: "explorer", c: "", s: null },
    ];
    const runner = scriptedRunner(() => succeeded(JSON.stringify(rows)));
    const table = readProcessTable("win32", runner.runCommand, NOW_MS);
    expect(runner.calls[0].executable).toBe("powershell.exe");
    expect(runner.calls[0].args).toContain("-EncodedCommand");
    const script = Buffer.from(runner.calls[0].args[runner.calls[0].args.length - 1], "base64").toString("utf16le");
    expect(script).toContain("Get-CimInstance Win32_Process");
    expect(table).toEqual([
      { pid: 10, parentPid: 4, executableName: "claude", commandLine: "claude.exe --resume x", ageMs: 60_000 },
      { pid: 11, parentPid: 10, executableName: "explorer", commandLine: "", ageMs: undefined },
    ]);
  });

  it("accepts a single row serialized as an object", () => {
    const runner = scriptedRunner(() => succeeded(JSON.stringify({ p: 3, pp: 0, n: "node", c: "node x", s: NOW_MS })));
    expect(readProcessTable("win32", runner.runCommand, NOW_MS)).toHaveLength(1);
  });

  it("skips rows without numeric pids and defaults missing names", () => {
    const runner = scriptedRunner(() => succeeded(JSON.stringify([{ p: "x", pp: 1 }, { p: 5, pp: 1 }])));
    expect(readProcessTable("win32", runner.runCommand, NOW_MS)).toEqual([
      { pid: 5, parentPid: 1, executableName: "", commandLine: "", ageMs: undefined },
    ]);
  });

  it("returns null when PowerShell fails or prints something that is not JSON", () => {
    expect(readProcessTable("win32", scriptedRunner(() => null).runCommand, NOW_MS)).toBeNull();
    expect(readProcessTable("win32", scriptedRunner(() => ({ exitCode: 1, stdout: "[]" })).runCommand, NOW_MS)).toBeNull();
    expect(readProcessTable("win32", scriptedRunner(() => succeeded("not json")).runCommand, NOW_MS)).toBeNull();
  });
});

describe("readProcessTable on POSIX", () => {
  it("parses ps rows, keeping command lines only for tracked executables", () => {
    const psOutput = [
      "    1     0 3-04:05:06 /sbin/launchd",
      "  200     1      01:05 /usr/local/bin/node /opt/muggle.js serve",
      "  201   200   02:03:04 /bin/bash /x/pr-watch-loop.sh --slot /h/s/csv",
      "garbage line",
    ].join("\n");
    const runner = scriptedRunner(() => succeeded(psOutput));
    const table = readProcessTable("darwin", runner.runCommand, NOW_MS);
    expect(runner.calls[0]).toMatchObject({ executable: "ps", args: ["-axo", "pid=,ppid=,etime=,command="] });
    expect(table).toEqual([
      { pid: 1, parentPid: 0, executableName: "launchd", commandLine: "", ageMs: 273_906_000 },
      { pid: 200, parentPid: 1, executableName: "node", commandLine: "/usr/local/bin/node /opt/muggle.js serve", ageMs: 65_000 },
      { pid: 201, parentPid: 200, executableName: "bash", commandLine: "/bin/bash /x/pr-watch-loop.sh --slot /h/s/csv", ageMs: 7_384_000 },
    ]);
  });

  it("returns null when ps fails", () => {
    expect(readProcessTable("linux", scriptedRunner(() => ({ exitCode: 1, stdout: "" })).runCommand, NOW_MS)).toBeNull();
  });
});

describe("parsePsElapsedSeconds", () => {
  it("reads every ps elapsed-time shape", () => {
    expect(parsePsElapsedSeconds("05:06")).toBe(306);
    expect(parsePsElapsedSeconds("04:05:06")).toBe(14_706);
    expect(parsePsElapsedSeconds("3-04:05:06")).toBe(273_906);
    expect(parsePsElapsedSeconds("soon")).toBeUndefined();
  });
});
