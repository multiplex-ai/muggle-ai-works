/**
 * The canned muggle tools the evals mount, independent of the host serving
 * them. The Claude harness mounts them in process through the agent SDK
 * (mock-mcp.ts); the Codex harness serves the same list over stdio
 * (mock-mcp-stdio.ts). One list is what keeps the two hosts judged against the
 * same fixture contract.
 */

import { z } from "zod";

import type { Fixtures, MockToolSpec } from "./types.js";

const PERMISSIVE_SHAPE = {} as const;

/**
 * Schema for the execute-* tools. The fields the gates care about
 * (`showUi`, `freshSession`) MUST be declared here — zod strips
 * undeclared keys before the SDK forwards them to canUseTool, so the
 * agent's emitted args would arrive empty otherwise.
 */
const EXECUTE_SHAPE = {
  testCase: z.unknown().optional(),
  testScript: z.unknown().optional(),
  actionScript: z.unknown().optional(),
  localUrl: z.string().optional(),
  showUi: z.boolean().optional(),
  freshSession: z.boolean().optional(),
  timeoutMs: z.number().optional(),
} as const;

const STUB_RUN = {
  runId: "run-stub",
  status: "passed",
  viewUrl: "https://example.invalid/run/stub",
};

/** A tool reply in the MCP content shape both hosts forward to the model. */
export function jsonResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

/** Every mock muggle tool, each answering with the scenario's fixture or a stub. */
export function mockToolSpecs(fixtures: Fixtures): MockToolSpec[] {
  return [
    {
      name: "muggle-local-telemetry-skill-emit",
      description: "Telemetry sink (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => ({ ok: true }),
    },
    {
      name: "muggle-local-telemetry-event-emit",
      description: "Failure-mode telemetry sink (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => ({ ok: true }),
    },
    {
      name: "muggle-local-check-status",
      description: "MCP server / local status (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => fixtures.checkStatus ?? { ok: true, authenticated: true, email: "tester@example.com" },
    },
    {
      name: "muggle-remote-auth-status",
      description: "Auth status (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => fixtures.authStatus ?? { authenticated: true, email: "tester@example.com" },
    },
    {
      name: "muggle-remote-auth-login",
      description: "Auth login (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => ({ verificationUrl: "https://example.invalid/login", code: "STUB" }),
    },
    {
      name: "muggle-remote-auth-api-key-create",
      description: "API key create (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => fixtures.apiKeyCreate ?? { apiKeyId: "key_stub", key: "mk_stub_key", name: "eval-stub" },
    },
    {
      name: "muggle-remote-auth-register",
      description: "Auth register (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () =>
        fixtures.authRegister ?? {
          outcome: "created",
          userId: "auth0|stub-registered",
          email: "tester@example.com",
          plan: "free",
          emailVerified: false,
          credentialStored: true,
          tokensGranted: 100000,
          tokensOnVerification: 1000000,
        },
    },
    {
      name: "muggle-remote-auth-poll",
      description: "Auth poll (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => ({ status: "complete", email: "tester@example.com" }),
    },
    {
      name: "muggle-local-last-project-get",
      description: "Last-project cache get (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => fixtures.lastProject ?? null,
    },
    {
      name: "muggle-local-last-project-set",
      description: "Last-project cache set (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => ({ ok: true }),
    },
    {
      name: "muggle-local-last-host-get",
      description: "Last-host cache get (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => fixtures.lastHost ?? null,
    },
    {
      name: "muggle-local-last-host-set",
      description: "Last-host cache set (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => ({ ok: true }),
    },
    {
      name: "muggle-remote-project-list",
      description: "Project list (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => fixtures.projects ?? { items: [] },
    },
    {
      name: "muggle-remote-use-case-list",
      description: "Use-case list (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => fixtures.useCases ?? { items: [] },
    },
    {
      name: "muggle-remote-test-case-list-by-use-case",
      description: "Test-case list (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => fixtures.testCases ?? { items: [] },
    },
    {
      name: "muggle-remote-test-case-get",
      description: "Test-case get (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () => fixtures.testCase ?? { id: "tc-stub", title: "Stub test case" },
    },
    {
      name: "muggle-remote-test-script-list",
      description: "Test-script list (mock — none).",
      shape: PERMISSIVE_SHAPE,
      reply: () => ({ items: [] }),
    },
    {
      name: "muggle-local-execute-test-generation",
      description: "Execute test generation (mock — args recorded by canUseTool, never actually runs).",
      shape: EXECUTE_SHAPE,
      reply: () => fixtures.executeResult ?? STUB_RUN,
    },
    {
      name: "muggle-local-execute-replay",
      description: "Execute replay (mock — args recorded by canUseTool, never actually runs).",
      shape: EXECUTE_SHAPE,
      reply: () => fixtures.executeResult ?? STUB_RUN,
    },
    {
      name: "muggle-local-run-result-get",
      description: "Run result (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () =>
        fixtures.runResult ?? {
          runId: "run-stub",
          status: "passed",
          steps: [],
          viewUrl: "https://example.invalid/run/stub",
          cloudTestScriptId: "cloud-ts-stub",
          cloudActionScriptId: "cloud-as-stub",
        },
    },
    {
      name: "muggle-local-run-steps-get",
      description: "A run's steps beside the frames they produced (mock).",
      shape: PERMISSIVE_SHAPE,
      reply: () =>
        fixtures.runStepsResult ?? {
          runId: "run-stub",
          status: "passed",
          verdict: null,
          steps: [],
          screenshotCount: 0,
        },
    },
  ];
}
