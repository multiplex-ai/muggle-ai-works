import { dirname } from "path";
import { fileURLToPath } from "url";

/**
 * The plugin tree this code ships in: the root the host exports, else the directory above the running bundle
 * (`plugin/scripts/<bundle>.mjs` resolves to `plugin/`).
 */
export function resolvePluginRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_PLUGIN_ROOT || env.CURSOR_PLUGIN_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
}
