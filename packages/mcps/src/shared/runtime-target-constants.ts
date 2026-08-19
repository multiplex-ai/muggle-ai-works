/**
 * Per-target configuration for @muggleai/works.
 *
 * The profile data lives in `config/runtime-targets.json` rather than in this
 * module because the install-time and release-verification scripts are plain
 * JavaScript and cannot import from the bundled TypeScript. One file keeps the
 * runtime, the installer, and the release gate from drifting apart.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import {
  ElectronAppReleaseStream,
  RuntimeTarget,
  type IElectronAppReleaseStreamProfile,
  type IRuntimeTargetProfile,
} from "./runtime-target-types.js";

/** OAuth scopes requested for every runtime target. */
export const DEFAULT_AUTH0_SCOPE = "openid profile email offline_access";

/** Base URL of the locally spawned web-service, which never varies by target. */
export const DEFAULT_WEB_SERVICE_URL = "http://localhost:3001";

/** Environment variable that overrides the runtime target baked into the package. */
export const RUNTIME_TARGET_ENV_VAR = "MUGGLE_MCP_PROMPT_SERVICE_TARGET";

/** Path of the profile data relative to the package root. */
export const RUNTIME_TARGETS_FILE = path.join("config", "runtime-targets.json");

/**
 * Resolve the package root from this module's location.
 *
 * Mirrors the resolution in config.ts: tsup bundles this module into dist/,
 * while tsc and vitest run it from packages/mcps/src/shared/.
 * @returns Absolute path of the package root.
 */
function getPackageRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));

  if (currentDir.includes(path.join("dist", "shared"))) {
    return path.resolve(currentDir, "..", "..");
  }

  if (currentDir.endsWith("dist")) {
    return path.resolve(currentDir, "..");
  }

  if (currentDir.includes(path.join("src", "shared"))) {
    return path.resolve(currentDir, "..", "..", "..", "..");
  }

  return path.dirname(currentDir);
}

/** Parsed shape of the runtime target profile data. */
interface IRuntimeTargetData {
  streams: Record<ElectronAppReleaseStream, IElectronAppReleaseStreamProfile>;
  targets: Record<RuntimeTarget, IRuntimeTargetProfile>;
}

/** Cached profile data, loaded once per process. */
let runtimeTargetDataCache: IRuntimeTargetData | null = null;

/**
 * Load the runtime target profile data.
 *
 * Output shape: `{ streams: { production: { electronAppReleaseTagPrefix } , ... },
 * targets: { production: { promptServiceBaseUrl, auth0Domain, auth0ClientId,
 * auth0Audience, electronAppReleaseStream }, ... } }`.
 * @returns Stream and target profiles.
 * @throws Error when the profile data is missing, unreadable, or incomplete.
 */
function getRuntimeTargetData(): IRuntimeTargetData {
  if (runtimeTargetDataCache) {
    return runtimeTargetDataCache;
  }

  const profilesPath = path.join(getPackageRoot(), RUNTIME_TARGETS_FILE);

  let parsedData: IRuntimeTargetData;
  try {
    parsedData = JSON.parse(fs.readFileSync(profilesPath, "utf-8"));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read runtime target profiles.\n` +
        `  Path: ${profilesPath}\n` +
        `  Error: ${errorMessage}\n` +
        `  This is a bug - please report it.`,
      { cause: error },
    );
  }

  for (const target of Object.values(RuntimeTarget)) {
    if (!parsedData.targets?.[target]) {
      throw new Error(
        `Missing runtime target '${target}' in profile data.\n` +
          `  Path: ${profilesPath}\n` +
          `  This is a bug - please report it.`,
      );
    }
  }

  for (const stream of Object.values(ElectronAppReleaseStream)) {
    if (!parsedData.streams?.[stream]) {
      throw new Error(
        `Missing electron-app release stream '${stream}' in profile data.\n` +
          `  Path: ${profilesPath}\n` +
          `  This is a bug - please report it.`,
      );
    }
  }

  runtimeTargetDataCache = parsedData;
  return runtimeTargetDataCache;
}

/**
 * Get the profile for every runtime target.
 * @returns Profile for every runtime target, keyed by target.
 */
export function getRuntimeTargetProfiles(): Record<RuntimeTarget, IRuntimeTargetProfile> {
  return getRuntimeTargetData().targets;
}

/**
 * Get the profile for every electron-app release stream.
 * @returns Profile for every release stream, keyed by stream.
 */
export function getElectronAppReleaseStreams(): Record<
  ElectronAppReleaseStream,
  IElectronAppReleaseStreamProfile
> {
  return getRuntimeTargetData().streams;
}

/**
 * Reset the cached profile data.
 */
export function resetRuntimeTargetProfiles(): void {
  runtimeTargetDataCache = null;
}
