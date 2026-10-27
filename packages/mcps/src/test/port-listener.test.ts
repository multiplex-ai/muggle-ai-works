/** Tests for reading which process listens on a local port. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock, platformMock } = vi.hoisted(() => ({ execFileMock: vi.fn(), platformMock: vi.fn() }));

vi.mock("node:child_process", () => ({ execFile: execFileMock }));
vi.mock("node:os", () => ({ platform: platformMock }));

type ToolReply = { stdout: string; exitCode?: number } | { missing: true };

// Answers each platform tool call in order, as execFile's callback would.
function replyInOrder(replies: ToolReply[]): void {
  const queue = [...replies];
  execFileMock.mockImplementation(
    (_command: string, _args: string[], _options: unknown, callback: (error: unknown, stdout: string) => void) => {
      const reply = queue.shift() ?? { stdout: "", exitCode: 1 };
      if ("missing" in reply) {
        callback(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }), "");
      } else if (reply.exitCode && reply.exitCode !== 0) {
        callback(Object.assign(new Error("exited"), { code: reply.exitCode, killed: false }), reply.stdout);
      } else {
        callback(null, reply.stdout);
      }
    },
  );
}

beforeEach(() => {
  execFileMock.mockReset();
  platformMock.mockReset();
});

async function loadReader() {
  return (await import("../shared/service-stack/port-listener.js")).readPortListener;
}

describe("readPortListener on Windows", () => {
  beforeEach(() => platformMock.mockReturnValue("win32"));

  const netstatOutput = [
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:39990          0.0.0.0:0              LISTENING       111",
    "  TCP    [::]:3999              [::]:0                 LISTENING       34016",
    "  TCP    127.0.0.1:3999         127.0.0.1:52000        ESTABLISHED     222",
  ].join("\r\n");

  it("names the listener from netstat, then its command line and parents", async () => {
    replyInOrder([
      { stdout: netstatOutput },
      { stdout: '{"commandLine":"node static_spa_server.cjs","ancestorPids":880}' },
    ]);

    expect(await (await loadReader())(3999)).toEqual({
      isReadable: true,
      listener: { pid: 34016, commandLine: "node static_spa_server.cjs", ancestorPids: [880] },
    });
  });

  it("reports nothing listening without starting PowerShell", async () => {
    replyInOrder([{ stdout: netstatOutput }]);

    expect(await (await loadReader())(5173)).toEqual({ isReadable: true, listener: null });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the listener PID when PowerShell cannot add its details", async () => {
    replyInOrder([{ stdout: netstatOutput }, { stdout: "", exitCode: 1 }]);

    expect(await (await loadReader())(3999)).toEqual({
      isReadable: true,
      listener: { pid: 34016, commandLine: "", ancestorPids: [] },
    });
  });

  it("reports the port unreadable when netstat fails", async () => {
    replyInOrder([{ stdout: "", exitCode: 1 }]);

    expect((await (await loadReader())(3999)).isReadable).toBe(false);
  });
});

describe("readPortListener on macOS and Linux", () => {
  beforeEach(() => platformMock.mockReturnValue("darwin"));

  it("walks the listener's parents with ps", async () => {
    replyInOrder([
      { stdout: "34016\n" },
      { stdout: "  880 node static_spa_server.cjs build 3999\n" },
      { stdout: "    1 /bin/zsh\n" },
    ]);

    expect(await (await loadReader())(3999)).toEqual({
      isReadable: true,
      listener: { pid: 34016, commandLine: "node static_spa_server.cjs build 3999", ancestorPids: [880, 1] },
    });
  });

  it("reports nothing listening when lsof finds no match", async () => {
    replyInOrder([{ stdout: "", exitCode: 1 }]);

    expect(await (await loadReader())(3999)).toEqual({ isReadable: true, listener: null });
  });

  it("reports the port unreadable when lsof is not installed", async () => {
    replyInOrder([{ missing: true }]);

    expect((await (await loadReader())(3999)).isReadable).toBe(false);
  });
});
