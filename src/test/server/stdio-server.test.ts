import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";

const { StdioServerTransport } = vi.hoisted(() => ({
  StdioServerTransport: vi.fn(function (this: Record<string, unknown>) {
    this.kind = "transport";
  }),
}));

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({ Server: vi.fn() }));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport }));
vi.mock("../../../packages/mcps/src/index.js", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

import { startStdioServer } from "../../server/stdio-server.js";

describe("startStdioServer", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let processOnSpy: ReturnType<typeof vi.spyOn>;
  let fakeStdin: EventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => undefined as never));
    processOnSpy = vi.spyOn(process, "on");
    fakeStdin = new EventEmitter();
    vi.spyOn(process, "stdin", "get").mockReturnValue(fakeStdin as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects the server to a stdio transport", async () => {
    const connect = vi.fn(async () => undefined);
    await startStdioServer({ connect } as never);

    expect(StdioServerTransport).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ kind: "transport" }));
  });

  it("registers SIGTERM/SIGINT handlers that exit cleanly", async () => {
    const connect = vi.fn(async () => undefined);
    await startStdioServer({ connect } as never);

    const signals = processOnSpy.mock.calls.map((c) => c[0]);
    expect(signals).toContain("SIGTERM");
    expect(signals).toContain("SIGINT");

    const sigterm = processOnSpy.mock.calls.find((c) => c[0] === "SIGTERM")?.[1] as () => void;
    sigterm();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits when stdin closes (parent-death detection)", async () => {
    const connect = vi.fn(async () => undefined);
    await startStdioServer({ connect } as never);

    fakeStdin.emit("end");
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockClear();
    fakeStdin.emit("close");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits when the polled parent process is gone (abrupt-death path)", async () => {
    vi.useFakeTimers();
    vi.spyOn(process, "ppid", "get").mockReturnValue(4242);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((): never => {
      const err = new Error("no such process") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    }) as never);

    const connect = vi.fn(async () => undefined);
    await startStdioServer({ connect } as never);
    expect(exitSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(killSpy).toHaveBeenCalledWith(4242, 0);
    expect(exitSpy).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });

  it("keeps running while the polled parent is alive", async () => {
    vi.useFakeTimers();
    vi.spyOn(process, "ppid", "get").mockReturnValue(4242);
    vi.spyOn(process, "kill").mockImplementation((() => true) as never);

    const connect = vi.fn(async () => undefined);
    await startStdioServer({ connect } as never);

    vi.advanceTimersByTime(120_000);
    expect(exitSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not poll when there is no real parent (ppid <= 1)", async () => {
    vi.useFakeTimers();
    vi.spyOn(process, "ppid", "get").mockReturnValue(1);
    const killSpy = vi.spyOn(process, "kill").mockImplementation((() => true) as never);

    const connect = vi.fn(async () => undefined);
    await startStdioServer({ connect } as never);

    vi.advanceTimersByTime(120_000);
    expect(killSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
