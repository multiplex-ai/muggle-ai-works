import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";

const { toolRequiresAuth, getCallerCredentials } = vi.hoisted(() => ({
  toolRequiresAuth: vi.fn(() => false),
  getCallerCredentials: vi.fn(() => ({})),
}));

vi.mock("../../../packages/mcps/src/index.js", () => ({
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  getCallerCredentials,
  getConfig: vi.fn(() => ({ serverName: "muggle", serverVersion: "1.2.3" })),
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  toolRequiresAuth,
}));

interface CapturedHandler {
  schema: { _capturedName?: string };
  handler: (req: unknown) => unknown;
}

const handlers: CapturedHandler[] = [];

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: vi.fn(function (this: Record<string, unknown>) {
    this.setRequestHandler = (schema: { _capturedName?: string }, handler: (req: unknown) => unknown) => {
      handlers.push({ schema, handler });
    };
  }),
}));

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  ListToolsRequestSchema: { _capturedName: "listTools" },
  CallToolRequestSchema: { _capturedName: "callTool" },
  ListResourcesRequestSchema: { _capturedName: "listResources" },
  ReadResourceRequestSchema: { _capturedName: "readResource" },
}));

import {
  registerTools,
  getAllTools,
  clearTools,
  createUnifiedMcpServer,
} from "../../server/mcp-server.js";

function handlerFor(name: string): (req: unknown) => unknown {
  const found = handlers.find((h) => h.schema._capturedName === name);
  if (!found) throw new Error(`handler ${name} not registered`);
  return found.handler;
}

function makeTool(overrides: Partial<{ name: string; inputSchema: unknown; execute: unknown }> = {}) {
  return {
    name: "muggle-remote-x",
    description: "desc",
    inputSchema: z.object({ a: z.string() }),
    execute: vi.fn(async () => ({ content: "ok", isError: false })),
    ...overrides,
  };
}

beforeEach(() => {
  handlers.length = 0;
  clearTools();
  vi.clearAllMocks();
  toolRequiresAuth.mockReturnValue(false);
  getCallerCredentials.mockReturnValue({});
});

describe("tool registry", () => {
  it("registers, lists, and clears tools", () => {
    expect(getAllTools()).toEqual([]);
    registerTools([makeTool({ name: "a" })]);
    registerTools([makeTool({ name: "b" })]);
    expect(getAllTools().map((t) => t.name)).toEqual(["a", "b"]);
    clearTools();
    expect(getAllTools()).toEqual([]);
  });
});

describe("createUnifiedMcpServer handlers", () => {
  afterEach(() => clearTools());

  it("ListTools converts native zod schemas to JSON schema", () => {
    registerTools([
      makeTool({ name: "t1", inputSchema: z.object({ url: z.string(), count: z.number().optional() }) }),
    ]);
    createUnifiedMcpServer({ enableQaTools: true, enableLocalTools: true });

    const result = handlerFor("listTools")({}) as { tools: Array<{ name: string; inputSchema: { type: string } }> };
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("t1");
    expect(result.tools[0].inputSchema.type).toBe("object");
  });

  it("ListTools falls back to a generic schema for non-zod inputs", () => {
    registerTools([makeTool({ name: "t2", inputSchema: { not: "zod" } })]);
    createUnifiedMcpServer({ enableQaTools: true, enableLocalTools: true });
    const result = handlerFor("listTools")({}) as { tools: Array<{ inputSchema: Record<string, unknown> }> };
    expect(result.tools[0].inputSchema).toMatchObject({ type: "object", additionalProperties: true });
  });

  it("CallTool returns NOT_FOUND for an unknown tool", async () => {
    createUnifiedMcpServer({ enableQaTools: true, enableLocalTools: true });
    const res = (await handlerFor("callTool")({ params: { name: "nope", arguments: {} } })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toBe("NOT_FOUND");
  });

  it("CallTool executes a found tool and returns its content", async () => {
    const execute = vi.fn(async () => ({ content: "done", isError: false }));
    registerTools([makeTool({ name: "go", execute })]);
    createUnifiedMcpServer({ enableQaTools: true, enableLocalTools: true });

    const res = (await handlerFor("callTool")({ params: { name: "go", arguments: { a: "1" } } })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ input: { a: "1" } }));
    expect(res.content[0].text).toBe("done");
    expect(res.isError).toBe(false);
  });

  it("CallTool maps ZodError to INVALID_ARGUMENT", async () => {
    const execute = vi.fn(async () => {
      z.object({ a: z.string() }).parse({ a: 1 });
    });
    registerTools([makeTool({ name: "bad", execute })]);
    createUnifiedMcpServer({ enableQaTools: true, enableLocalTools: true });

    const res = (await handlerFor("callTool")({ params: { name: "bad", arguments: {} } })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toBe("INVALID_ARGUMENT");
  });

  it("CallTool maps generic errors to INTERNAL_ERROR", async () => {
    const execute = vi.fn(async () => {
      throw new Error("boom");
    });
    registerTools([makeTool({ name: "err", execute })]);
    createUnifiedMcpServer({ enableQaTools: true, enableLocalTools: true });

    const res = (await handlerFor("callTool")({ params: { name: "err", arguments: {} } })) as {
      content: Array<{ text: string }>;
    };
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.error).toBe("INTERNAL_ERROR");
    expect(parsed.message).toBe("boom");
  });

  it("CallTool defaults arguments to an empty object", async () => {
    const execute = vi.fn(async () => ({ content: "x", isError: false }));
    registerTools([makeTool({ name: "noargs", execute })]);
    createUnifiedMcpServer({ enableQaTools: true, enableLocalTools: true });

    await handlerFor("callTool")({ params: { name: "noargs" } });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ input: {} }));
  });

  it("ListResources returns an empty list", () => {
    createUnifiedMcpServer({ enableQaTools: true, enableLocalTools: true });
    expect(handlerFor("listResources")({})).toEqual({ resources: [] });
  });

  it("ReadResource echoes a not-found resource for the requested uri", () => {
    createUnifiedMcpServer({ enableQaTools: true, enableLocalTools: true });
    const res = handlerFor("readResource")({ params: { uri: "muggle://x" } }) as {
      contents: Array<{ uri: string; text: string }>;
    };
    expect(res.contents[0].uri).toBe("muggle://x");
    expect(res.contents[0].text).toContain("Resource not found");
  });

  it("passes credentials through JIT auth for tools that require it", async () => {
    toolRequiresAuth.mockReturnValue(true);
    getCallerCredentials.mockReturnValue({ apiKey: "k" });
    const execute = vi.fn(async () => ({ content: "auth-ok", isError: false }));
    registerTools([makeTool({ name: "secure", execute })]);
    createUnifiedMcpServer({ enableQaTools: true, enableLocalTools: true });

    const res = (await handlerFor("callTool")({ params: { name: "secure", arguments: {} } })) as {
      content: Array<{ text: string }>;
    };
    expect(execute).toHaveBeenCalledOnce();
    expect(res.content[0].text).toBe("auth-ok");
  });

  it("executes auth-required tools even when no credentials are stored", async () => {
    toolRequiresAuth.mockReturnValue(true);
    getCallerCredentials.mockReturnValue({});
    const execute = vi.fn(async () => ({ content: "ran", isError: false }));
    registerTools([makeTool({ name: "secure2", execute })]);
    createUnifiedMcpServer({ enableQaTools: true, enableLocalTools: true });

    await handlerFor("callTool")({ params: { name: "secure2", arguments: {} } });
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe("legacy zod-to-json-schema conversion", () => {
  function legacy(def: Record<string, unknown>): { _def: Record<string, unknown> } {
    return { _def: def };
  }

  function jsonSchemaFor(inputSchema: unknown): Record<string, unknown> {
    clearTools();
    registerTools([makeTool({ name: "legacy", inputSchema })]);
    createUnifiedMcpServer({ enableQaTools: true, enableLocalTools: true });
    const result = handlerFor("listTools")({}) as {
      tools: Array<{ inputSchema: Record<string, unknown> }>;
    };
    return result.tools[0].inputSchema;
  }

  beforeEach(() => {
    handlers.length = 0;
    clearTools();
  });

  it("converts an object with required and optional string properties", () => {
    const schema = legacy({
      typeName: "ZodObject",
      shape: () => ({
        url: legacy({ typeName: "ZodString", description: "u", checks: [{ kind: "min", value: 1 }, { kind: "url" }] }),
        opt: legacy({ typeName: "ZodOptional", innerType: legacy({ typeName: "ZodString" }) }),
      }),
    });
    const out = jsonSchemaFor(schema);
    expect(out.type).toBe("object");
    expect((out.properties as Record<string, unknown>).url).toMatchObject({ type: "string", format: "uri" });
    expect(out.required).toEqual(["url"]);
  });

  it("converts number, boolean, array, and enum types", () => {
    expect(jsonSchemaFor(legacy({ typeName: "ZodNumber", checks: [{ kind: "int" }, { kind: "min", value: 0 }] })))
      .toMatchObject({ type: "integer", minimum: 0 });
    expect(jsonSchemaFor(legacy({ typeName: "ZodBoolean", description: "b" }))).toMatchObject({ type: "boolean" });
    expect(jsonSchemaFor(legacy({ typeName: "ZodArray", element: legacy({ typeName: "ZodString" }) })))
      .toMatchObject({ type: "array", items: { type: "string" } });
    expect(jsonSchemaFor(legacy({ typeName: "ZodEnum", values: ["a", "b"] })))
      .toMatchObject({ type: "string", enum: ["a", "b"] });
  });

  it("converts unions and falls back to object for unknown types", () => {
    const union = jsonSchemaFor(
      legacy({ typeName: "ZodUnion", options: [legacy({ typeName: "ZodString" }), legacy({ typeName: "ZodNumber" })] }),
    );
    expect((union.oneOf as unknown[]).length).toBe(2);
    expect(jsonSchemaFor(legacy({ typeName: "ZodWeird" }))).toMatchObject({ type: "object" });
  });
});
