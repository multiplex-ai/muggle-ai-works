/**
 * Logger module for @muggleai/works.
 * Provides structured logging using Winston.
 */

import winston from "winston";

import { getConfig } from "./config.js";

/** Cached logger instance. */
let loggerInstance: winston.Logger | null = null;

/**
 * Create the Winston logger with appropriate configuration.
 * @returns Configured Winston logger.
 */
function createLogger(): winston.Logger {
  const config = getConfig();

  // Use JSON format for structured logging to stderr (MCP-safe)
  const format = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  );

  return winston.createLogger({
    level: config.logLevel,
    format: format,
    defaultMeta: {
      service: config.serverName,
      version: config.serverVersion,
    },
    transports: [
      // Log to stderr to avoid interfering with MCP stdio transport
      new winston.transports.Console({
        stderrLevels: ["error", "warn", "info", "http", "verbose", "debug", "silly"],
      }),
    ],
  });
}

/**
 * Get the logger instance (singleton).
 * @returns Winston logger.
 */
export function getLogger(): winston.Logger {
  if (!loggerInstance) {
    loggerInstance = createLogger();
  }
  return loggerInstance;
}

/**
 * Create a child logger with additional context.
 * @param correlationId - Request correlation ID.
 * @returns Child logger with correlation context.
 */
export function createChildLogger(correlationId: string): winston.Logger {
  const logger = getLogger();
  return logger.child({ correlationId: correlationId });
}

/**
 * Reset the logger (for testing).
 */
export function resetLogger(): void {
  loggerInstance = null;
}
