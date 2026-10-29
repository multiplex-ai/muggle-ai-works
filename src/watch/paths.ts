import { homedir } from "os";
import { join } from "path";
import { getDataDir } from "../../packages/mcps/src/shared/data-dir.js";
import {
  CLAUDE_GLOBAL_CONFIG_FILE_NAME,
  CLAUDE_INSTALLED_PLUGINS_RELATIVE_PATH,
  CLAUDE_PROJECTS_DIR_NAME,
  CLAUDE_SESSION_REGISTRY_DIR_NAME,
  MUGGLE_INSTALL_LOG_FILE,
  PR_WATCH_SLOTS_RELATIVE_PATH,
  WATCH_DIR_NAME,
} from "./constants.js";
import type { WatchPaths } from "./types.js";

/**
 * Where the watch reads and writes, honouring the agents' own home overrides
 * (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) so it sees the same files they do.
 */
export function resolveWatchPaths(env: NodeJS.ProcessEnv = process.env): WatchPaths {
  const muggleDataDir = getDataDir();
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const codexHome = env.CODEX_HOME || join(homedir(), ".codex");
  return {
    watchDir: join(muggleDataDir, WATCH_DIR_NAME),
    slotsDir: join(muggleDataDir, ...PR_WATCH_SLOTS_RELATIVE_PATH),
    claudeSessionRegistryDir: join(claudeConfigDir, CLAUDE_SESSION_REGISTRY_DIR_NAME),
    claudeProjectsDir: join(claudeConfigDir, CLAUDE_PROJECTS_DIR_NAME),
    claudeInstalledPluginsFile: join(claudeConfigDir, ...CLAUDE_INSTALLED_PLUGINS_RELATIVE_PATH),
    claudeGlobalConfigFile: join(env.CLAUDE_CONFIG_DIR || homedir(), CLAUDE_GLOBAL_CONFIG_FILE_NAME),
    codexSessionsDir: join(codexHome, "sessions"),
    muggleInstallLogFile: join(muggleDataDir, MUGGLE_INSTALL_LOG_FILE),
  };
}
