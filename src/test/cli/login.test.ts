import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const getAuthStatus = vi.fn();

vi.mock("../../../packages/mcps/src/index.js", () => ({
  getAuthService: vi.fn(() => ({ getAuthStatus })),
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  hasApiKey: vi.fn(),
  performLogin: vi.fn(),
  performLogout: vi.fn(),
}));

import { loginCommand, logoutCommand, statusCommand } from "../../cli/login.js";
import {
  hasApiKey,
  performLogin,
  performLogout,
} from "../../../packages/mcps/src/index.js";

const mockedHasApiKey = vi.mocked(hasApiKey);
const mockedPerformLogin = vi.mocked(performLogin);
const mockedPerformLogout = vi.mocked(performLogout);

describe("loginCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => undefined as never));
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("prints success details and default 90d expiry when login succeeds", async () => {
    mockedPerformLogin.mockResolvedValue({
      success: true,
      credentials: { email: "a@b.com", apiKey: "k" },
    } as never);

    await loginCommand({});

    expect(mockedPerformLogin).toHaveBeenCalledWith(undefined, "90d");
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("Login successful");
    expect(out).toContain("a@b.com");
    expect(out).toContain("API key created");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("passes through key name and custom expiry", async () => {
    mockedPerformLogin.mockResolvedValue({ success: true, credentials: {} } as never);
    await loginCommand({ keyName: "ci", keyExpiry: "1y" });
    expect(mockedPerformLogin).toHaveBeenCalledWith("ci", "1y");
  });

  it("reports error and device code, then exits 1 on failure", async () => {
    mockedPerformLogin.mockResolvedValue({
      success: false,
      error: "denied",
      deviceCodeResponse: {
        verificationUriComplete: "https://verify/abc",
        userCode: "WXYZ",
      },
    } as never);

    await loginCommand({});

    const err = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(err).toContain("Login failed");
    expect(err).toContain("denied");
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("https://verify/abc");
    expect(out).toContain("WXYZ");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("logoutCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => logSpy.mockRestore());

  it("clears credentials", async () => {
    await logoutCommand();
    expect(mockedPerformLogout).toHaveBeenCalledOnce();
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("cleared");
  });
});

describe("statusCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => logSpy.mockRestore());

  it("prints authenticated details including expired token note and api key", async () => {
    getAuthStatus.mockReturnValue({
      authenticated: true,
      email: "u@e.com",
      userId: "uid-1",
      expiresAt: new Date("2020-01-01T00:00:00Z").getTime(),
      isExpired: true,
    });
    mockedHasApiKey.mockReturnValue(true);

    await statusCommand();

    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("Authenticated");
    expect(out).toContain("u@e.com");
    expect(out).toContain("uid-1");
    expect(out).toContain("expired");
    expect(out).toContain("API Key: Yes");
  });

  it("prints not-authenticated guidance", async () => {
    getAuthStatus.mockReturnValue({ authenticated: false });
    mockedHasApiKey.mockReturnValue(false);

    await statusCommand();

    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("Not authenticated");
    expect(out).toContain("muggle login");
  });
});
