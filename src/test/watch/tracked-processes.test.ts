import { describe, expect, it } from "vitest";
import { classifyTrackedProcesses, watchSlotSlugOf } from "../../watch/tracked-processes.js";
import { TrackedProcessKind, type ProcessTableEntry } from "../../watch/types.js";

function entry(pid: number, parentPid: number, executableName: string, commandLine = ""): ProcessTableEntry {
  return { pid: pid, parentPid: parentPid, executableName: executableName, commandLine: commandLine, ageMs: 1000 };
}

const SERVER_COMMAND = '"node" "C:\\npm\\node_modules\\@muggleai\\works\\bin\\muggle.js" serve';
const NPX_SERVER_COMMAND = '"node.exe" "npx-cli.js" "-y" "@muggleai/works" "serve"';
const LOOP_COMMAND = '"bash.exe" /c/npm/plugin/scripts/pr-watch-loop.sh --slot C:/Users/u/.muggle-ai/muggle-do/sessions/csv-export --repo o/r --pr 7 --base main';

describe("classifyTrackedProcesses", () => {
  it("keeps only the tracked kinds", () => {
    const tracked = classifyTrackedProcesses(
      [
        entry(1, 0, "claude"),
        entry(2, 0, "codex-x86_64-pc-windows-msvc"),
        entry(3, 1, "node", SERVER_COMMAND),
        entry(4, 1, "bash", LOOP_COMMAND),
        entry(5, 1, "node", "node build.js"),
        entry(6, 1, "explorer"),
      ],
      "win32",
    );
    expect(tracked.map((process_) => process_.kind)).toEqual([
      TrackedProcessKind.ClaudeCli,
      TrackedProcessKind.CodexCli,
      TrackedProcessKind.MuggleMcpServer,
      TrackedProcessKind.PrWatchLoop,
    ]);
    expect(tracked[3]).toMatchObject({ watchSlotSlug: "csv-export", isOrphaned: undefined });
  });

  it("on Windows, flags a server whose ancestor died before an agent was reached", () => {
    const table = [entry(1, 0, "claude"), entry(2, 1, "cmd"), entry(3, 2, "node", SERVER_COMMAND), entry(4, 99, "cmd"), entry(5, 4, "node", NPX_SERVER_COMMAND)];
    const servers = classifyTrackedProcesses(table, "win32").filter((tracked) => tracked.kind === TrackedProcessKind.MuggleMcpServer);
    expect(servers.map((server) => [server.pid, server.isOrphaned])).toEqual([[3, false], [5, true]]);
  });

  it("on Windows, does not flag a server started from a user's own shell", () => {
    const table = [entry(1, 0, "explorer"), entry(2, 1, "pwsh"), entry(3, 2, "node", SERVER_COMMAND)];
    expect(classifyTrackedProcesses(table, "win32")[0].isOrphaned).toBe(false);
  });

  it("on POSIX, treats reparenting to init as the orphan signal", () => {
    const table = [entry(10, 1, "node", SERVER_COMMAND), entry(11, 10, "node", SERVER_COMMAND)];
    expect(classifyTrackedProcesses(table, "linux").map((tracked) => tracked.isOrphaned)).toEqual([true, false]);
  });

  it("stops climbing after the hop limit rather than looping on a cycle", () => {
    const table = [entry(1, 2, "cmd"), entry(2, 1, "cmd"), entry(3, 1, "node", SERVER_COMMAND)];
    expect(classifyTrackedProcesses(table, "win32")[0].isOrphaned).toBe(false);
  });
});

describe("watchSlotSlugOf", () => {
  it("reads quoted, unquoted and backslashed slot paths", () => {
    expect(watchSlotSlugOf(LOOP_COMMAND)).toBe("csv-export");
    expect(watchSlotSlugOf('bash pr-watch-loop.sh --slot "C:\\Users\\A B\\sessions\\my-slot\\" --pr 1')).toBe("my-slot");
    expect(watchSlotSlugOf("bash something-else.sh")).toBeUndefined();
  });
});
