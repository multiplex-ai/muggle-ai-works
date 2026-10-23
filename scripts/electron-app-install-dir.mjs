/**
 * Release stream whose studio installs into the bare version directory, so
 * installs that predate per-stream directories stay valid.
 */
const BARE_DIRECTORY_RELEASE_STREAM = "production";

const BARE_VERSION_DIRECTORY_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Build the directory name, under `~/.muggle-ai/electron-app`, that a studio
 * release installs into. Mirrors `buildElectronAppDirName` in
 * packages/mcps/src/shared/electron-app-install-dir.ts, which is where the
 * runtime looks for the binary.
 * @param {object} params - Directory parameters.
 * @param {string} params.version - Electron app version.
 * @param {string} params.releaseStream - Release stream the binary came from.
 * @returns {string} Directory name, for example "1.9.0" or "1.9.0-staging".
 */
export function buildElectronAppDirName({ version, releaseStream }) {
    if (releaseStream === BARE_DIRECTORY_RELEASE_STREAM) {
        return version;
    }
    return `${version}-${releaseStream}`;
}

/**
 * Whether a directory under `~/.muggle-ai/electron-app` is an outdated install
 * of the given stream. Each install lane prunes only its own stream's
 * directories, so a staging install never deletes the production studio and a
 * production install never deletes the staging one.
 * @param {object} params - Check parameters.
 * @param {string} params.directoryName - Directory to classify.
 * @param {string} params.releaseStream - Stream the current install belongs to.
 * @param {string} params.currentDirectoryName - Directory the current install uses.
 * @returns {boolean} True when the directory belongs to the stream and is not the current install.
 */
export function isOutdatedStreamInstall({ directoryName, releaseStream, currentDirectoryName }) {
    if (directoryName === currentDirectoryName) {
        return false;
    }
    if (releaseStream === BARE_DIRECTORY_RELEASE_STREAM) {
        return BARE_VERSION_DIRECTORY_PATTERN.test(directoryName);
    }
    const streamSuffix = `-${releaseStream}`;
    return (
        directoryName.endsWith(streamSuffix) &&
        BARE_VERSION_DIRECTORY_PATTERN.test(directoryName.slice(0, -streamSuffix.length))
    );
}
