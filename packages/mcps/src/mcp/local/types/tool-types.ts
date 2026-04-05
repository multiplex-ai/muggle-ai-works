/**
 * Tool types for local E2E acceptance module.
 */

import type { ZodSchema } from "zod";

/**
 * MCP tool result.
 */
export interface IMcpToolResult {
  /** Human-readable content. */
  content: string;
  /** Whether this is an error result. */
  isError: boolean;
  /** Structured data (optional). */
  data?: unknown;
}

/**
 * Tool execution context.
 */
export interface IToolExecutionContext {
  /** Input parameters. */
  input: unknown;
  /** Correlation ID for tracing. */
  correlationId: string;
}

/**
 * MCP tool definition.
 */
export interface ILocalMcpTool {
  /** Tool name. */
  name: string;
  /** Tool description. */
  description: string;
  /** Zod input schema. */
  inputSchema: ZodSchema;
  /** Tool execution function. */
  execute: (context: IToolExecutionContext) => Promise<IMcpToolResult>;
}
