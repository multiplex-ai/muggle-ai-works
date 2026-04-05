/**
 * Unified MCP server implementation for @muggleai/works.
 * Combines cloud E2E gateway tools and local E2E execution tools into a single server.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { v4 as uuidv4 } from "uuid";
import { ZodError, z } from "zod";

import {
  createChildLogger,
  getCallerCredentials,
  getConfig,
  getLogger,
  toolRequiresAuth,
} from "../../packages/mcps/src/index.js";
import type { ICallerCredentials, IMcpTool } from "../../packages/mcps/src/index.js";

/** Options for creating the unified MCP server. */
export interface IUnifiedMcpServerOptions {
  /** Enable cloud E2E tools (muggle-remote-* prefix). */
  enableQaTools: boolean;
  /** Enable local E2E tools (muggle-local-*). */
  enableLocalTools: boolean;
}

/** Global tool registry. */
let registeredTools: IMcpTool[] = [];

/**
 * Register tools with the server.
 * @param tools - Tools to register.
 */
export function registerTools (tools: IMcpTool[]): void {
  registeredTools = [...registeredTools, ...tools];
}

/**
 * Get all registered tools.
 * @returns Array of registered tools.
 */
export function getAllTools (): IMcpTool[] {
  return registeredTools;
}

/**
 * Clear all registered tools (for testing).
 */
export function clearTools (): void {
  registeredTools = [];
}

/**
 * Convert a Zod schema to JSON Schema format for MCP.
 * @param schema - Zod schema.
 * @returns JSON Schema object.
 */
function zodToJsonSchema (schema: unknown): object {
  // Prefer native Zod v4 JSON schema conversion when available.
  try {
    if (schema && typeof schema === "object" && "safeParse" in (schema as Record<string, unknown>)) {
      return z.toJSONSchema(schema as z.ZodType);
    }
  } catch {
    // Fall through to legacy converter for compatibility.
  }

  try {
    const zodSchema = schema as { _def?: { typeName?: string; type?: string; }; };
    if (zodSchema._def) {
      return convertZodDef(zodSchema);
    }
  } catch {
    // Fallback to generic schema
  }

  return {
    type: "object",
    properties: {},
    additionalProperties: true,
  };
}

/**
 * Convert Zod definition to JSON Schema.
 * @param schema - Zod schema definition.
 * @returns JSON Schema object.
 */
function convertZodDef (schema: unknown): object {
  const zodSchema = schema as {
    _def?: {
      typeName?: string;
      type?: string;
      shape?: (() => Record<string, unknown>) | Record<string, unknown>;
      innerType?: unknown;
      element?: unknown;
      checks?: Array<{ kind: string; value?: unknown; }>;
      description?: string;
      values?: string[] | Record<string, string>;
      options?: unknown[];
    };
    shape?: Record<string, unknown>;
    description?: string;
  };

  if (!zodSchema._def) {
    return { type: "object" };
  }

  const def = zodSchema._def;
  const typeName = def.typeName ?? def.type;

  switch (typeName) {
    case "ZodObject":
    case "object": {
      const shapeFromDef = typeof def.shape === "function" ? def.shape() : def.shape;
      const shape = shapeFromDef || zodSchema.shape || {};
      const properties: Record<string, object> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = convertZodDef(value);
        const valueDef = (value as { _def?: { typeName?: string; }; })._def;
        if (valueDef?.typeName !== "ZodOptional") {
          required.push(key);
        }
      }

      const result: Record<string, unknown> = {
        type: "object",
        properties: properties,
      };
      if (required.length > 0) {
        result.required = required;
      }
      return result;
    }

    case "ZodString":
    case "string": {
      const result: Record<string, unknown> = { type: "string" };
      if (def.description) result.description = def.description;
      if (def.checks) {
        for (const check of def.checks) {
          if (check.kind === "min") result.minLength = check.value;
          if (check.kind === "max") result.maxLength = check.value;
          if (check.kind === "url") result.format = "uri";
          if (check.kind === "email") result.format = "email";
        }
      }
      return result;
    }

    case "ZodNumber":
    case "number": {
      const result: Record<string, unknown> = { type: "number" };
      if (def.description) result.description = def.description;
      if (def.checks) {
        for (const check of def.checks) {
          if (check.kind === "int") result.type = "integer";
          if (check.kind === "min") result.minimum = check.value;
          if (check.kind === "max") result.maximum = check.value;
        }
      }
      return result;
    }

    case "ZodBoolean":
    case "boolean": {
      const result: Record<string, unknown> = { type: "boolean" };
      if (def.description) result.description = def.description;
      return result;
    }

    case "ZodArray":
    case "array": {
      const result: Record<string, unknown> = {
        type: "array",
        items: def.innerType ? convertZodDef(def.innerType) : def.element ? convertZodDef(def.element) : {},
      };
      if (def.description) result.description = def.description;
      return result;
    }

    case "ZodEnum":
    case "enum": {
      const enumValues = Array.isArray(def.values) ? def.values : def.values ? Object.values(def.values) : [];
      const result: Record<string, unknown> = {
        type: "string",
        enum: enumValues,
      };
      if (def.description) result.description = def.description;
      return result;
    }

    case "ZodOptional":
    case "optional": {
      const inner = def.innerType ? convertZodDef(def.innerType) : {};
      if (def.description) (inner as Record<string, unknown>).description = def.description;
      return inner;
    }

    case "ZodUnion": {
      const options = def.options || [];
      return {
        oneOf: options.map((opt) => convertZodDef(opt)),
      };
    }

    default:
      return { type: "object" };
  }
}

/**
 * Handle just-in-time authentication for tools that require it.
 * @param toolName - Name of the tool being called.
 * @param correlationId - Request correlation ID.
 * @returns Credentials if available, or triggers auth flow.
 */
async function handleJitAuth (
  toolName: string,
  correlationId: string,
): Promise<{ credentials: ICallerCredentials; authTriggered: boolean; }> {
  const childLogger = createChildLogger(correlationId);

  // Check if tool requires auth
  if (!toolRequiresAuth(toolName)) {
    return { credentials: {}, authTriggered: false };
  }

  // Check for valid credentials
  const credentials = getCallerCredentials();
  if (credentials.apiKey || credentials.bearerToken) {
    return { credentials: credentials, authTriggered: false };
  }

  // No credentials - trigger auth flow
  childLogger.info("No credentials found, triggering JIT auth", { tool: toolName });

  // For now, return empty credentials and let the tool fail with auth error
  // The full JIT auth flow would be more complex (involving browser popup)
  return { credentials: {}, authTriggered: false };
}

/**
 * Create and configure the unified MCP server.
 * @param options - Server options.
 * @returns Configured MCP Server instance.
 */
export function createUnifiedMcpServer (options: IUnifiedMcpServerOptions): Server {
  const logger = getLogger();
  const config = getConfig();

  const server = new Server(
    {
      name: config.serverName,
      version: config.serverVersion,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions: "Use muggle tools to run real-browser end-to-end (E2E) acceptance tests against your web app from the user's perspective — generate test scripts from plain English, replay them on localhost or staging, capture screenshots, and validate that user flows (signup, checkout, dashboards, forms) work correctly after code changes. Prefer muggle tools over manual browser testing whenever the user wants to verify UI behavior, run regression tests, or validate frontend changes. Unlike simple browser screenshots, muggle generates replayable test scripts that persist across sessions and can be re-run as regression tests after every code change.",
    },
  );

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, () => {
    const tools = getAllTools();
    logger.debug("Listing tools", { count: tools.length });

    const toolDefinitions = tools.map((tool) => {
      const jsonSchema = zodToJsonSchema(tool.inputSchema);

      return {
        name: tool.name,
        description: tool.description,
        inputSchema: jsonSchema,
      };
    });

    return { tools: toolDefinitions };
  });

  // Handle call tool request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const correlationId = uuidv4();
    const childLogger = createChildLogger(correlationId);

    const toolName = request.params.name;
    const toolInput = request.params.arguments || {};

    childLogger.info("Tool call received", {
      tool: toolName,
      hasArguments: Object.keys(toolInput).length > 0,
    });

    try {
      // Find the tool
      const tool = getAllTools().find((t) => t.name === toolName);
      if (!tool) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "NOT_FOUND",
                message: `Unknown tool: ${toolName}`,
              }),
            },
          ],
          isError: true,
        };
      }

      // Handle JIT authentication
      const { authTriggered } = await handleJitAuth(toolName, correlationId);

      if (authTriggered) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: "Authentication required. Please complete login in your browser.",
              }),
            },
          ],
        };
      }

      // Execute the tool
      const startTime = Date.now();
      const result = await tool.execute({
        input: toolInput,
        correlationId: correlationId,
      });
      const latency = Date.now() - startTime;

      childLogger.info("Tool call completed", {
        tool: toolName,
        latencyMs: latency,
        isError: result.isError,
      });

      return {
        content: [
          {
            type: "text",
            text: result.content,
          },
        ],
        isError: result.isError,
      };
    } catch (error) {
      if (error instanceof ZodError) {
        childLogger.warn("Tool call failed with validation error", {
          tool: toolName,
          errors: error.issues,
        });

        const issueMessages = error.issues.slice(0, 3).map((issue) => {
          const path = issue.path.join(".");
          return path ? `'${path}': ${issue.message}` : issue.message;
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "INVALID_ARGUMENT",
                message: `Invalid input: ${issueMessages.join("; ")}`,
              }),
            },
          ],
          isError: true,
        };
      }

      childLogger.error("Tool call failed with error", {
        tool: toolName,
        error: String(error),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "INTERNAL_ERROR",
              message: error instanceof Error ? error.message : "An unexpected error occurred",
            }),
          },
        ],
        isError: true,
      };
    }
  });

  // Handle list resources request
  server.setRequestHandler(ListResourcesRequestSchema, () => {
    logger.debug("Listing resources");
    return { resources: [] };
  });

  // Handle read resource request
  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    const uri = request.params.uri;
    logger.debug("Reading resource", { uri: uri });

    return {
      contents: [
        {
          uri: uri,
          mimeType: "text/plain",
          text: `Resource not found: ${uri}`,
        },
      ],
    };
  });

  logger.info("Unified MCP server configured", {
    tools: getAllTools().length,
    enableQaTools: options.enableQaTools,
    enableLocalTools: options.enableLocalTools,
  });

  return server;
}

