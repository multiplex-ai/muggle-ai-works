import { ELECTRON_APP_DIR_VERSION_PREFIX_PATTERN } from "./electron-app-install-dir-constants.js";
import type { IElectronAppInstallDirName } from "./electron-app-install-dir-types.js";
import { ElectronAppReleaseStream } from "./runtime-target-types.js";

/**
 * Build the install directory name for an electron-app version.
 *
 * Both release streams publish the same version deliberately, so a version
 * alone does not identify a binary. Without the stream in the path, installing
 * a staging harness on a machine that already has the production studio finds
 * the directory present, skips the download, and runs the production studio
 * against the staging backend — and no checksum catches it, because
 * verification only happens on download.
 *
 * The production stream keeps the bare version so existing installs are not
 * orphaned and nobody re-downloads on upgrade. `scripts/electron-app-install-dir.mjs`
 * mirrors this for the npm postinstall, which cannot import TypeScript.
 * @param params - Directory parameters.
 * @param params.version - Electron app version.
 * @param params.releaseStream - Release stream the binary came from.
 * @returns Directory name, for example "1.9.0" or "1.9.0-staging".
 */
export function buildElectronAppDirName(params: {
  version: string;
  releaseStream: ElectronAppReleaseStream;
}): string {
  if (params.releaseStream === ElectronAppReleaseStream.Production) {
    return params.version;
  }
  return `${params.version}-${params.releaseStream}`;
}

/**
 * Read the version and release stream back out of an install directory name.
 *
 * A name parses only when {@link buildElectronAppDirName} rebuilds it exactly,
 * so listing and pruning installs can never disagree with where the runtime
 * looks for them.
 * @param directoryName - Entry name under `~/.muggle-ai/electron-app`.
 * @returns The encoded version and stream, or null when no stream builds this name.
 *
 * Output shape: `{ version: "1.13.9", releaseStream: "staging" }` for "1.13.9-staging".
 */
export function parseElectronAppDirName(directoryName: string): IElectronAppInstallDirName | null {
  const versionMatch = ELECTRON_APP_DIR_VERSION_PREFIX_PATTERN.exec(directoryName);
  if (!versionMatch) {
    return null;
  }

  const version = versionMatch[0];
  const releaseStream = Object.values(ElectronAppReleaseStream).find(
    (candidateStream) =>
      buildElectronAppDirName({ version: version, releaseStream: candidateStream }) === directoryName,
  );

  if (!releaseStream) {
    return null;
  }
  return { version: version, releaseStream: releaseStream };
}
