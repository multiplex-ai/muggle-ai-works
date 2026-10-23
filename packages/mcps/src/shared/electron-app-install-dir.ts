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
