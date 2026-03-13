/**
 * HTTP client for forwarding requests to prompt-service.
 */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";

import { getConfig } from "../shared/config.js";
import { getLogger } from "../shared/logger.js";

import {
  GatewayError,
  ICallerCredentials,
  IUpstreamCall,
  IUpstreamResponse,
  McpErrorCode,
} from "./types.js";

/** Allowed upstream path prefixes. */
const ALLOWED_UPSTREAM_PREFIXES = [
  "/v1/protected/muggle-test/",
  "/v1/protected/wallet/",
  "/v1/protected/api-keys",
];

/**
 * Client for forwarding requests to prompt-service with auth passthrough.
 */
export class PromptServiceClient {
  private readonly httpClient: AxiosInstance;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor() {
    const config = getConfig();
    this.baseUrl = config.qa.promptServiceBaseUrl;
    this.requestTimeoutMs = config.qa.requestTimeoutMs;

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: this.requestTimeoutMs,
      validateStatus: () => true,
    });
  }

  /**
   * Validate that the upstream path is within the allowed prefix.
   * @param path - Path to validate.
   * @throws GatewayError if path is not allowed.
   */
  private validatePath(path: string): void {
    const isAllowed = ALLOWED_UPSTREAM_PREFIXES.some((prefix) => path.startsWith(prefix));

    if (!isAllowed) {
      const logger = getLogger();
      logger.error("Path not in allowlist", {
        path: path,
        allowedPrefixes: ALLOWED_UPSTREAM_PREFIXES,
      });
      throw new GatewayError({
        code: McpErrorCode.FORBIDDEN,
        message: `Path '${path}' is not allowed`,
      });
    }
  }

  /**
   * Build headers for upstream request with credential forwarding.
   * @param credentials - Caller credentials to forward.
   * @param correlationId - Request correlation ID.
   * @returns Headers object.
   */
  private buildHeaders(
    credentials: ICallerCredentials,
    correlationId: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "X-Correlation-Id": correlationId,
    };

    if (credentials.bearerToken) {
      headers["Authorization"] = credentials.bearerToken.startsWith("Bearer ")
        ? credentials.bearerToken
        : `Bearer ${credentials.bearerToken}`;
    }

    if (credentials.apiKey) {
      headers["x-api-key"] = credentials.apiKey;
    }

    return headers;
  }

  /**
   * Build query string from parameters.
   * @param params - Query parameters.
   * @returns Query string (without leading '?').
   */
  private buildQueryString(
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    if (!params) {
      return "";
    }

    const entries = Object.entries(params)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);

    return entries.length > 0 ? `?${entries.join("&")}` : "";
  }

  /**
   * Map HTTP status code to MCP error code.
   * @param statusCode - HTTP status code.
   * @returns MCP error code.
   */
  private mapStatusToErrorCode(statusCode: number): McpErrorCode {
    if (statusCode === 401) {
      return McpErrorCode.UNAUTHORIZED;
    }
    if (statusCode === 403) {
      return McpErrorCode.FORBIDDEN;
    }
    if (statusCode === 404) {
      return McpErrorCode.NOT_FOUND;
    }
    if (statusCode >= 400 && statusCode < 500) {
      return McpErrorCode.INVALID_ARGUMENT;
    }
    return McpErrorCode.UPSTREAM_ERROR;
  }

  /**
   * Format upstream error response into a user-friendly message.
   * @param statusCode - HTTP status code.
   * @param data - Response data from upstream.
   * @returns User-friendly error message.
   */
  private formatUpstreamErrorMessage(statusCode: number, data: unknown): string {
    const responseData = data as {
      error?: string;
      message?: string;
      detail?: string;
      details?: string;
    } | null;

    const rawMessage =
      responseData?.message ||
      responseData?.error ||
      responseData?.detail ||
      responseData?.details;

    if (rawMessage && typeof rawMessage === "string") {
      let cleaned = rawMessage
        .replace(/^Error:\s*/i, "")
        .replace(/^INVALID_ARGUMENT:\s*/i, "")
        .replace(/^NOT_FOUND:\s*/i, "")
        .replace(/^FORBIDDEN:\s*/i, "");

      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      return cleaned;
    }

    switch (statusCode) {
      case 400:
        return "Invalid request. Please check your input parameters.";
      case 401:
        return "Authentication required. Please check your credentials.";
      case 403:
        return "You don't have permission to perform this action.";
      case 404:
        return "The requested resource was not found.";
      case 409:
        return "A conflict occurred. The resource may already exist.";
      case 429:
        return "Too many requests. Please wait and try again.";
      case 500:
        return "The service encountered an error. Please try again later.";
      case 502:
      case 503:
      case 504:
        return "The service is temporarily unavailable. Please try again later.";
      default:
        return `Request failed with status ${statusCode}.`;
    }
  }

  /**
   * Execute an upstream call to prompt-service.
   * @param call - Upstream call specification.
   * @param credentials - Caller credentials to forward.
   * @param correlationId - Request correlation ID.
   * @returns Upstream response.
   * @throws GatewayError on validation or upstream errors.
   */
  async execute<T = unknown>(
    call: IUpstreamCall,
    credentials: ICallerCredentials,
    correlationId: string,
  ): Promise<IUpstreamResponse<T>> {
    const logger = getLogger();

    // Validate credentials
    if (!credentials.bearerToken && !credentials.apiKey) {
      throw new GatewayError({
        code: McpErrorCode.UNAUTHORIZED,
        message: "Missing authentication. Please run 'muggle-mcp login' to authenticate.",
      });
    }

    // Validate path
    this.validatePath(call.path);

    const url = call.path + this.buildQueryString(call.queryParams);
    const headers = this.buildHeaders(credentials, correlationId);
    const timeout = call.timeoutMs || this.requestTimeoutMs;

    const startTime = Date.now();

    logger.info("Upstream request", {
      correlationId: correlationId,
      method: call.method,
      path: call.path,
      hasBody: !!call.body,
    });

    try {
      const requestConfig: AxiosRequestConfig = {
        method: call.method,
        url: url,
        headers: headers,
        timeout: timeout,
      };

      if (call.body && ["POST", "PUT", "PATCH"].includes(call.method)) {
        requestConfig.data = call.body;
        requestConfig.headers = {
          ...headers,
          "Content-Type": "application/json",
        };
      } else {
        requestConfig.headers = {
          ...headers,
          "Content-Type": "application/json",
        };
      }

      const response = await this.httpClient.request(requestConfig);
      const latency = Date.now() - startTime;

      logger.info("Upstream response", {
        correlationId: correlationId,
        statusCode: response.status,
        latencyMs: latency,
      });

      // Handle error responses
      if (response.status >= 400) {
        const errorCode = this.mapStatusToErrorCode(response.status);
        const errorMessage = this.formatUpstreamErrorMessage(response.status, response.data);

        throw new GatewayError({
          code: errorCode,
          message: errorMessage,
          statusCode: response.status,
        });
      }

      // Extract response headers
      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(response.headers)) {
        if (typeof value === "string") {
          responseHeaders[key.toLowerCase()] = value;
        }
      }

      return {
        statusCode: response.status,
        data: response.data as T,
        headers: responseHeaders,
      };
    } catch (error) {
      const latency = Date.now() - startTime;

      if (error instanceof GatewayError) {
        throw error;
      }

      if (error instanceof AxiosError) {
        logger.error("Upstream request failed", {
          correlationId: correlationId,
          error: error.message,
          code: error.code,
          latencyMs: latency,
        });

        if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
          throw new GatewayError({
            code: McpErrorCode.UPSTREAM_ERROR,
            message: `Request timeout after ${timeout}ms`,
            details: { upstreamPath: call.path },
          });
        }

        throw new GatewayError({
          code: McpErrorCode.UPSTREAM_ERROR,
          message: `Upstream connection error: ${error.message}`,
          details: { upstreamPath: call.path },
        });
      }

      logger.error("Unknown upstream error", {
        correlationId: correlationId,
        error: String(error),
        latencyMs: latency,
      });

      throw new GatewayError({
        code: McpErrorCode.INTERNAL_ERROR,
        message: "Internal gateway error",
      });
    }
  }
}

/** Singleton client instance. */
let clientInstance: PromptServiceClient | null = null;

/**
 * Get the PromptServiceClient instance (singleton).
 * @returns PromptServiceClient instance.
 */
export function getPromptServiceClient(): PromptServiceClient {
  if (!clientInstance) {
    clientInstance = new PromptServiceClient();
  }
  return clientInstance;
}
