/**
 * MCP core package entry.
 */

export * from "./shared/types.js";
export * from "./shared/runtime-target-types.js";
export * from "./shared/runtime-target.js";
export * from "./shared/checksum.js";
export * from "./shared/electron-app-executable-types.js";
export * from "./shared/electron-app-executable-constants.js";
export * from "./shared/electron-app-executable.js";
export * from "./shared/electron-app-install-dir-types.js";
export * from "./shared/electron-app-install-dir.js";
export * from "./shared/logger.js";
export * from "./shared/open-browser.js";
export * from "./mcp/local/services/run-view/index.js";
export * from "./shared/api-key.js";
export * from "./shared/config.js";
export * from "./shared/auth.js";
export * from "./shared/checkout-freshness.js";
export * from "./shared/tool-input-schema/tool-input-schema.js";
export * as mcp from "./mcp/index.js";
export * as e2e from "./mcp/e2e/index.js";
export * as qa from "./mcp/e2e/index.js";
export * as localQa from "./mcp/local/index.js";
export { getAuthService } from "./mcp/local/services/index.js";
export { getLocalQaTools } from "./mcp/local/index.js";
export { getQaTools } from "./mcp/e2e/index.js";
export * from "./shared/preferences-types.js";
export * from "./shared/project-preferences-reconcile-types.js";
export * from "./shared/preferences-constants.js";
export * from "./shared/watcher-lifetime-constants.js";
export * from "./shared/preferences-service.js";
export * from "./shared/onboarding/onboarding-types.js";
export * from "./shared/onboarding/onboarding-constants.js";
export * from "./shared/onboarding/onboarding-service.js";
