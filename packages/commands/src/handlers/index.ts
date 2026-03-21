/**
 * Transitional command handler exports.
 *
 * The command implementations currently live in `src/cli` and are consumed
 * through this package surface to establish package boundaries first.
 */

export { cleanupCommand, versionsCommand } from "../../../../src/cli/cleanup.js";
export { doctorCommand } from "../../../../src/cli/doctor.js";
export { helpCommand } from "../../../../src/cli/help.js";
export { loginCommand, logoutCommand, statusCommand } from "../../../../src/cli/login.js";
export { serveCommand } from "../../../../src/cli/serve.js";
export { setupCommand } from "../../../../src/cli/setup.js";
export { upgradeCommand } from "../../../../src/cli/upgrade.js";
