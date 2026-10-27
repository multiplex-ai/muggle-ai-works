/**
 * Release stream whose studio installs into the bare version directory, so
 * installs that predate per-stream directories stay valid.
 */
const BARE_DIRECTORY_RELEASE_STREAM = "production";

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

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

function readStreamInstallVersion({ directoryName, releaseStream }) {
    if (releaseStream === BARE_DIRECTORY_RELEASE_STREAM) {
        return RELEASE_VERSION_PATTERN.test(directoryName) ? directoryName : null;
    }
    const streamSuffix = `-${releaseStream}`;
    if (!directoryName.endsWith(streamSuffix)) {
        return null;
    }
    const version = directoryName.slice(0, -streamSuffix.length);
    return RELEASE_VERSION_PATTERN.test(version) ? version : null;
}

function compareReleaseVersions(leftVersion, rightVersion) {
    const leftParts = leftVersion.split(".").map(Number);
    const rightParts = rightVersion.split(".").map(Number);
    for (let partIndex = 0; partIndex < leftParts.length; partIndex++) {
        if (leftParts[partIndex] !== rightParts[partIndex]) {
            return leftParts[partIndex] - rightParts[partIndex];
        }
    }
    return 0;
}

/**
 * Whether a directory under `~/.muggle-ai/electron-app` is a studio install of
 * the given stream. Each install lane only ever touches its own stream's
 * directories, so a staging install never deletes the production studio and a
 * production install never deletes the staging one.
 * @param {object} params - Check parameters.
 * @param {string} params.directoryName - Directory to classify.
 * @param {string} params.releaseStream - Stream the current install belongs to.
 * @returns {boolean} True when the directory holds a release of that stream.
 */
export function isStreamInstall({ directoryName, releaseStream }) {
    return readStreamInstallVersion({ directoryName: directoryName, releaseStream: releaseStream }) !== null;
}

/**
 * Whether a stream install is older than the current one and so safe to prune.
 * A newer install — a dev build or a later release someone chose on purpose —
 * is never outdated, whatever the bundled pin says.
 * @param {object} params - Check parameters.
 * @param {string} params.directoryName - Directory to classify.
 * @param {string} params.releaseStream - Stream the current install belongs to.
 * @param {string} params.currentDirectoryName - Directory the current install uses.
 * @returns {boolean} True when the directory holds an older release of the same stream.
 */
export function isOutdatedStreamInstall({ directoryName, releaseStream, currentDirectoryName }) {
    const installVersion = readStreamInstallVersion({ directoryName: directoryName, releaseStream: releaseStream });
    const currentVersion = readStreamInstallVersion({
        directoryName: currentDirectoryName,
        releaseStream: releaseStream,
    });
    if (installVersion === null || currentVersion === null) {
        return false;
    }
    return compareReleaseVersions(installVersion, currentVersion) < 0;
}

/**
 * Whether an install keeps the user's studio version override. An override
 * naming a release newer than the bundled pin was chosen on purpose and stays;
 * one the pin has caught up with, or one naming a non-release build, resets so
 * nobody stays silently pinned to an old or dev studio.
 * @param {object} params - Check parameters.
 * @param {string} params.overrideVersion - Version the override file names.
 * @param {string} params.bundledVersion - Version this works install pins.
 * @returns {boolean} True when the override names a newer release than the pin.
 */
export function shouldKeepVersionOverride({ overrideVersion, bundledVersion }) {
    if (!RELEASE_VERSION_PATTERN.test(overrideVersion) || !RELEASE_VERSION_PATTERN.test(bundledVersion)) {
        return false;
    }
    return compareReleaseVersions(overrideVersion, bundledVersion) > 0;
}
