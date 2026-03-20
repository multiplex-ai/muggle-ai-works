/**
 * Lightweight logger for mcp-core package modules.
 */

/**
 * Minimal logger contract used by core shared modules.
 */
interface ICoreLogger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Create a package-local logger implementation.
 * Uses console output to keep early migration slices decoupled.
 */
function createCoreLogger(): ICoreLogger {
  return {
    debug: (message: string, meta?: Record<string, unknown>): void => {
      console.debug(message, meta ?? {});
    },
    info: (message: string, meta?: Record<string, unknown>): void => {
      console.info(message, meta ?? {});
    },
    warn: (message: string, meta?: Record<string, unknown>): void => {
      console.warn(message, meta ?? {});
    },
    error: (message: string, meta?: Record<string, unknown>): void => {
      console.error(message, meta ?? {});
    },
  };
}

/** Cached logger instance. */
let loggerInstance: ICoreLogger | null = null;

/**
 * Get singleton logger instance.
 */
export function getLogger(): ICoreLogger {
  if (loggerInstance) {
    return loggerInstance;
  }

  loggerInstance = createCoreLogger();
  return loggerInstance;
}
