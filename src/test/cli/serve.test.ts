import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const {
  getQaTools,
  getLocalQaTools,
  registerTools,
  createUnifiedMcpServer,
  startStdioServer,
  hasShownDisclosure,
  markDisclosureShown,
  initTelemetry,
  track,
} = vi.hoisted(() => ({
  getQaTools: vi.fn(() => [{ name: "qa1" }]),
  getLocalQaTools: vi.fn(() => [{ name: "local1" }]),
  registerTools: vi.fn(),
  createUnifiedMcpServer: vi.fn(() => ({ kind: "server" })),
  startStdioServer: vi.fn(async () => undefined),
  hasShownDisclosure: vi.fn(() => false),
  markDisclosureShown: vi.fn(),
  initTelemetry: vi.fn(),
  track: vi.fn(),
}));

vi.mock("../../../packages/mcps/src/index.js", () => ({
  getConfig: vi.fn(() => ({ serverVersion: "9.9.9" })),
  getQaTools,
  getLocalQaTools,
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

vi.mock("@muggleai/telemetry", () => ({
  EventName: { SystemStartup: "SystemStartup" },
  ServiceName: { MuggleMcp: "MuggleMcp" },
  Surface: { McpLocal: "McpLocal" },
  getDisclosureCopy: vi.fn(() => "disclosure copy"),
  hasShownDisclosure,
  markDisclosureShown,
  initTelemetry,
  track,
}));

vi.mock("../../server/index.js", () => ({
  createUnifiedMcpServer,
  registerTools,
  startStdioServer,
}));

import { serveCommand } from "../../cli/serve.js";

describe("serveCommand", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    hasShownDisclosure.mockReturnValue(false);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => undefined as never));
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("registers both tool sets by default and shows the first-run disclosure", async () => {
    await serveCommand({});

    expect(getQaTools).toHaveBeenCalledOnce();
    expect(getLocalQaTools).toHaveBeenCalledOnce();
    expect(registerTools).toHaveBeenCalledTimes(2);
    expect(createUnifiedMcpServer).toHaveBeenCalledWith({
      enableQaTools: true,
      enableLocalTools: true,
    });
    expect(startStdioServer).toHaveBeenCalledWith({ kind: "server" });
    expect(stderrSpy).toHaveBeenCalledWith("disclosure copy\n");
    expect(markDisclosureShown).toHaveBeenCalledOnce();
    expect(initTelemetry).toHaveBeenCalledOnce();
    expect(track).toHaveBeenCalledOnce();
  });

  it("registers only cloud tools when --e2e is set", async () => {
    await serveCommand({ e2e: true });
    expect(getQaTools).toHaveBeenCalledOnce();
    expect(getLocalQaTools).not.toHaveBeenCalled();
    expect(createUnifiedMcpServer).toHaveBeenCalledWith({
      enableQaTools: true,
      enableLocalTools: false,
    });
  });

  it("registers only local tools when --local is set", async () => {
    await serveCommand({ local: true });
    expect(getLocalQaTools).toHaveBeenCalledOnce();
    expect(getQaTools).not.toHaveBeenCalled();
    expect(createUnifiedMcpServer).toHaveBeenCalledWith({
      enableQaTools: false,
      enableLocalTools: true,
    });
  });

  it("skips the disclosure when already shown", async () => {
    hasShownDisclosure.mockReturnValue(true);
    await serveCommand({});
    expect(markDisclosureShown).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalledWith("disclosure copy\n");
  });

  it("swallows telemetry init failures and still starts the server", async () => {
    initTelemetry.mockImplementationOnce(() => {
      throw new Error("telemetry down");
    });
    await serveCommand({});
    expect(startStdioServer).toHaveBeenCalledOnce();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits 1 when the server fails to start", async () => {
    startStdioServer.mockRejectedValueOnce(new Error("connect failed"));
    await serveCommand({});
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
