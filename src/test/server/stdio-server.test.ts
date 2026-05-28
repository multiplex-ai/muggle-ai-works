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
});
