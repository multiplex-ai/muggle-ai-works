/**
 * Type definitions for cloud E2E acceptance gateway tools.
 */

import type { ZodSchema } from "zod";

/**
 * MCP error codes.
 */
export enum McpErrorCode {
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  INVALID_ARGUMENT = "INVALID_ARGUMENT",
  UPSTREAM_ERROR = "UPSTREAM_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

/**
 * Gateway error with MCP error code.
 */
export class GatewayError extends Error {
  /** MCP error code. */
  public readonly code: McpErrorCode;

  /** HTTP status code (if applicable). */
  public readonly statusCode?: number;

  /** Additional error details. */
  public readonly details?: Record<string, unknown>;

  constructor(params: {
    code: McpErrorCode;
    message: string;
    statusCode?: number;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = "GatewayError";
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.details = params.details;
  }
}

/**
 * Mapped upstream HTTP call specification.
 */
export interface IUpstreamCall {
  /** HTTP method. */
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

  /** Path relative to prompt-service base URL. */
  path: string;

  /** Query parameters. */
  queryParams?: Record<string, string | number | boolean | undefined>;

  /** Request body (for POST/PUT/PATCH). */
  body?: unknown;

  /** Optional multipart form-data upload. */
  multipartFormData?: {
    /** Field name for the uploaded file (e.g., "file"). */
    fileFieldName: string;
    /** File name to provide to upstream. */
    fileName: string;
    /** MIME type for the uploaded file. */
    contentType: string;
    /** Base64-encoded file bytes. */
    fileBase64: string;
  };

  /** Timeout in milliseconds (overrides default). */
  timeoutMs?: number;
}

/**
 * Upstream response.
 */
export interface IUpstreamResponse<T = unknown> {
  /** HTTP status code. */
  statusCode: number;
  /** Response data. */
  data: T;
  /** Response headers. */
  headers: Record<string, string>;
}

/**
 * Caller credentials for API requests.
 */
export interface ICallerCredentials {
  /** Bearer token (from device code flow or config). */
  bearerToken?: string;
  /** API key (from device code flow or config). */
  apiKey?: string;
}

/**
 * Cloud E2E acceptance tool definition with schema, description, and implementation.
 */
export interface IQaToolDefinition {
  /** Tool name (used in MCP). */
  name: string;

  /** Tool description (shown to LLM). */
  description: string;

  /** Input schema (Zod). */
  inputSchema: ZodSchema;

  /** Whether this tool requires authentication (default: true). */
  requiresAuth?: boolean;

  /** Map validated input to upstream call. */
  mapToUpstream: (input: unknown) => IUpstreamCall;

  /** Map upstream response to tool output. */
  mapFromUpstream?: (response: IUpstreamResponse, input?: unknown) => unknown;

  /**
   * Local handler for tools that don't make upstream calls.
   * Used for auth tools and recommendation tools.
   */
  localHandler?: (input: unknown) => Promise<unknown>;
}
