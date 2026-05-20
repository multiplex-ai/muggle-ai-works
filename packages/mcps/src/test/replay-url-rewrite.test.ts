/**
 * Tests for rewriteActionScriptUrls — the local-replay URL substitution
 * that points cloud-recorded action scripts at a local dev URL. See
 * `mcp/local/services/replay-url-rewrite.ts` and issue #163.
 */

import { describe, expect, it } from "vitest";

import { rewriteActionScriptUrls } from "../mcp/local/services/replay-url-rewrite.js";

const ORIGINAL = "https://staging.muggle-ai.com/muggleTestV0/dashboard";
const LOCAL = "http://localhost:3999";

function makeStep(operation: Record<string, unknown>): Record<string, unknown> {
  return { briefExplanation: "", operation: operation, comment: "" };
}

describe("rewriteActionScriptUrls", () => {
  it("returns the input unchanged when originalUrl is missing", () => {
    const steps = [makeStep({ action: "click", elementId: 3 })];
    const result = rewriteActionScriptUrls({
      actionScript: steps,
      localUrl: LOCAL,
    });
    expect(result).toEqual(steps);
  });

  it("rewrites the first navigate step's URL to localUrl regardless of recorded value", () => {
    const steps = [
      makeStep({
        action: "navigate",
        url: "https://login.staging.muggle-ai.com/u/login?state=abc",
      }),
    ];
    const result = rewriteActionScriptUrls({
      actionScript: steps,
      originalUrl: ORIGINAL,
      localUrl: LOCAL,
    });
    const firstNavigate = (result[0] as { operation: { url: string } }).operation;
    expect(firstNavigate.url).toBe(LOCAL);
  });

  it("rewrites subdomain hostnames of the original host inside any operation field", () => {
    const steps = [
      makeStep({ action: "click", elementId: 1, domainUrl: "login.staging.muggle-ai.com" }),
      makeStep({
        action: "navigate",
        url: "https://login.staging.muggle-ai.com/u/login?state=abc",
      }),
      makeStep({ action: "click", domainUrl: "staging.muggle-ai.com" }),
    ];
    const result = rewriteActionScriptUrls({
      actionScript: steps,
      originalUrl: ORIGINAL,
      localUrl: LOCAL,
    }) as Array<{ operation: Record<string, unknown> }>;

    expect(result[0]!.operation["domainUrl"]).toBe("login.staging.muggle-ai.com");
    expect(JSON.stringify(result)).not.toContain("https://login.staging.muggle-ai.com");
    expect(JSON.stringify(result)).not.toContain("https://staging.muggle-ai.com");
    expect(JSON.stringify(result)).toContain(LOCAL);
  });

  it("does not rewrite unrelated hosts like accounts.google.com", () => {
    const steps = [
      makeStep({
        action: "navigate",
        url: "https://staging.muggle-ai.com/start",
      }),
      makeStep({
        action: "secretInput",
        domainUrl: "accounts.google.com",
        elementId: 1,
      }),
      makeStep({
        action: "click",
        url: "https://accounts.google.com/signin/oauth",
      }),
    ];
    const result = rewriteActionScriptUrls({
      actionScript: steps,
      originalUrl: ORIGINAL,
      localUrl: LOCAL,
    }) as Array<{ operation: Record<string, unknown> }>;

    expect(result[1]!.operation["domainUrl"]).toBe("accounts.google.com");
    expect(result[2]!.operation["url"]).toBe("https://accounts.google.com/signin/oauth");
  });

  it("leaves scripts with no navigate step otherwise functional", () => {
    const steps = [
      makeStep({ action: "click", elementId: 1, domainUrl: "staging.muggle-ai.com" }),
      makeStep({ action: "halt" }),
    ];
    const result = rewriteActionScriptUrls({
      actionScript: steps,
      originalUrl: ORIGINAL,
      localUrl: LOCAL,
    }) as Array<{ operation: Record<string, unknown> }>;

    expect(result).toHaveLength(2);
    expect(result[0]!.operation["action"]).toBe("click");
    expect(result[1]!.operation["action"]).toBe("halt");
  });

  it("forces only the first navigate step, leaves later navigates' subdomain-rewritten URLs intact", () => {
    const steps = [
      makeStep({
        action: "navigate",
        url: "https://login.staging.muggle-ai.com/u/login?state=abc",
      }),
      makeStep({ action: "click", elementId: 7 }),
      makeStep({
        action: "navigate",
        url: "https://staging.muggle-ai.com/muggleTestV0/dashboard/projects/1",
      }),
    ];
    const result = rewriteActionScriptUrls({
      actionScript: steps,
      originalUrl: ORIGINAL,
      localUrl: LOCAL,
    }) as Array<{ operation: Record<string, unknown> }>;

    expect(result[0]!.operation["url"]).toBe(LOCAL);
    expect(result[2]!.operation["url"]).toBe(`${LOCAL}/muggleTestV0/dashboard/projects/1`);
  });

  it("preserves localUrl with a non-default port and arbitrary scheme", () => {
    const steps = [
      makeStep({ action: "navigate", url: "https://staging.muggle-ai.com/start" }),
      makeStep({ action: "click", domainUrl: "api.staging.muggle-ai.com" }),
    ];
    const result = rewriteActionScriptUrls({
      actionScript: steps,
      originalUrl: ORIGINAL,
      localUrl: "http://localhost:3999",
    }) as Array<{ operation: Record<string, unknown> }>;

    expect(result[0]!.operation["url"]).toBe("http://localhost:3999");
    expect(result[1]!.operation["domainUrl"]).toBe("api.staging.muggle-ai.com");
  });

  it("falls back to a literal-string substitution when originalUrl is not a parseable URL", () => {
    const literal = "not a url at all 123";
    const steps = [
      makeStep({
        action: "navigate",
        url: `${literal}/dashboard`,
      }),
    ];
    const result = rewriteActionScriptUrls({
      actionScript: steps,
      originalUrl: literal,
      localUrl: LOCAL,
    }) as Array<{ operation: Record<string, unknown> }>;

    expect(result[0]!.operation["url"]).toBe(`${LOCAL}/dashboard`);
  });
});
