import { serveCommand } from "../../../cli/serve.js";
import { MCP_SERVER_STARTUP_SETTLE_MS } from "./constants.js";

// Startup work that serveCommand does not await, such as telemetry resource detection, gets the settle window to run.
await serveCommand({});
setTimeout(() => process.exit(0), MCP_SERVER_STARTUP_SETTLE_MS);
