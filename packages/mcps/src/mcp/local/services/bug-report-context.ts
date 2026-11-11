import * as os from "node:os";

import { sanitizeBugReportClientContext } from "../../../shared/bug-report/index.js";
import type { ISanitizedBugReportClientContext } from "../../../shared/bug-report/index.js";
import { getActiveElectronAppReleaseStream, getConfig, getElectronAppVersion } from "../../../shared/config.js";
import { buildElectronAppDirName } from "../../../shared/electron-app-install-dir.js";
import { readLastProject } from "../../../shared/last-project.js";
import { getLogger } from "../../../shared/logger.js";
import { getRunResultStorageService } from "./run-result-storage-service.js";

function readOptionalSource<TSourceValue>(sourceName: string, readSource: () => TSourceValue | undefined): TSourceValue | undefined {
  try {
    return readSource();
  } catch (error) {
    // A missing or unreadable source leaves its field out; the rest of the context still goes.
    getLogger().warn("Bug report context source unavailable", {
      sourceName: sourceName,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Gather the harness context a bug report carries: CLI and Studio versions, operating system, the
 * last project selected for this directory, and the newest local run with its outcome. Values that
 * look like secrets are dropped before they are returned.
 * @param params - Gathering parameters.
 * @param params.cwd - Working directory the last-used project is keyed on.
 * @returns The context safe to send and the fields dropped as secret-looking.
 *
 * Output shape: `{ clientContext: { cliVersion: "5.35.0", studioVersion: "1.25.0", os: "darwin 24.1.0 arm64", lastProjectId: "p1", lastLocalRunId: "r1", lastLocalRunStatus: "passed" }, strippedFieldNames: [] }`
 */
export function collectBugReportClientContext(params: { cwd: string }): ISanitizedBugReportClientContext {
  const newestLocalRun = readOptionalSource("runResults", () => getRunResultStorageService().listRunResults()[0]);

  return sanitizeBugReportClientContext({
    cliVersion: readOptionalSource("cliVersion", () => getConfig().serverVersion),
    studioVersion: readOptionalSource("studioVersion", () =>
      buildElectronAppDirName({
        version: getElectronAppVersion(),
        releaseStream: getActiveElectronAppReleaseStream(),
      }),
    ),
    os: readOptionalSource("os", () => `${os.platform()} ${os.release()} ${os.arch()}`),
    lastProjectId: readOptionalSource("lastProject", () => readLastProject(params.cwd)?.projectId),
    lastLocalRunId: newestLocalRun?.id,
    lastLocalRunStatus: newestLocalRun?.status,
  });
}
