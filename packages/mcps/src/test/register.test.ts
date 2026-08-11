/** Tests for headless account registration. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const savedApiKeys = vi.hoisted(
  () => [] as Array<{ apiKey: string; apiKeyId: string }>,
);

vi.mock("../shared/api-key.js", () => ({
  saveApiKey: (params: { apiKey: string; apiKeyId: string }) => {
    savedApiKeys.push(params);
  },
}));

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({ e2e: { promptServiceBaseUrl: "https://prompt.test" } }),
}));

vi.mock("../shared/install_id.js", () => ({
  getInstallId: () => "install-test",
}));

vi.mock("../shared/logger.js", () => {
  const noop = (): undefined => undefined;
  const silentLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: () => silentLogger,
  };
  return {
    getLogger: () => silentLogger,
    createChildLogger: () => silentLogger,
    resetLogger: noop,
  };
});

vi.mock("axios", () => {
  const post = vi.fn();
  return {
    default: {
      post: post,
      isAxiosError: (candidate: unknown) =>
        Boolean((candidate as { isAxiosError?: boolean })?.isAxiosError),
    },
  };
});

import axios from "axios";

import { registerAccount } from "../shared/register.js";
import { RegisterOutcome } from "../shared/register-types.js";

const mockedPost = axios.post as unknown as ReturnType<typeof vi.fn>;

function buildHttpError(status: number, body?: unknown): Error {
  const httpError = new Error(`status ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number; data?: unknown };
  };
  httpError.isAxiosError = true;
  httpError.response = { status: status, data: body };
  return httpError;
}

describe("registerAccount", () => {
  beforeEach(() => {
    savedApiKeys.length = 0;
    mockedPost.mockReset();
  });

  it("stores the returned key and reports the starter allowance", async () => {
    mockedPost.mockResolvedValue({
      data: {
        userId: "auth0|new",
        email: "agent@example.com",
        plan: "free",
        emailVerified: false,
        apiKey: "mk_secret",
        tokensGranted: 100000,
        tokensOnVerification: 1000000,
      },
    });

    const registration = await registerAccount("agent@example.com", "long-enough-password");

    expect(registration.outcome).toBe(RegisterOutcome.Created);
    expect(registration.credentialStored).toBe(true);
    expect(registration.tokensGranted).toBe(100000);
    expect(savedApiKeys).toEqual([{ apiKey: "mk_secret", apiKeyId: "auth0|new" }]);
    expect(registration.message).toContain("verify agent@example.com");
  });

  it("sends the install id so the service can throttle on it", async () => {
    mockedPost.mockResolvedValue({
      data: {
        userId: "auth0|new",
        email: "agent@example.com",
        plan: "free",
        emailVerified: false,
        apiKey: "mk_secret",
        tokensGranted: 100000,
        tokensOnVerification: 1000000,
      },
    });

    await registerAccount("agent@example.com", "long-enough-password");

    expect(mockedPost).toHaveBeenCalledWith(
      "https://prompt.test/v1/public/auth/register",
      expect.objectContaining({ installId: "install-test" }),
      expect.anything(),
    );
  });

  it("points a duplicate address at login instead of failing", async () => {
    mockedPost.mockRejectedValue(buildHttpError(409));

    const registration = await registerAccount("taken@example.com", "long-enough-password");

    expect(registration.outcome).toBe(RegisterOutcome.AlreadyRegistered);
    expect(registration.message).toContain("muggle-remote-auth-login");
    expect(savedApiKeys).toHaveLength(0);
  });

  it("surfaces the wait when a throttle refused the attempt", async () => {
    mockedPost.mockRejectedValue(buildHttpError(429, { retryAfterSeconds: 900 }));

    const registration = await registerAccount("agent@example.com", "long-enough-password");

    expect(registration.outcome).toBe(RegisterOutcome.Throttled);
    expect(registration.retryAfterSeconds).toBe(900);
    expect(registration.message).toContain("900 seconds");
  });

  it("rethrows a failure that is neither a duplicate nor a throttle", async () => {
    mockedPost.mockRejectedValue(buildHttpError(500));

    await expect(
      registerAccount("agent@example.com", "long-enough-password"),
    ).rejects.toThrow("status 500");
  });
});
