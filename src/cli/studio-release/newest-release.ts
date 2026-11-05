import { ELECTRON_APP_CHECKSUMS_ASSET_NAME } from "../../../packages/mcps/src/shared/electron-app-executable-constants.js";
import {
  SIGNATURE_BUNDLE_SUFFIX,
  compareVersions,
  resolveIntegrityPolicy,
} from "../../../scripts/release-integrity/index.mjs";
import {
  GITHUB_RELEASES_API,
  GITHUB_RELEASES_API_HEADERS,
  MAX_RELEASE_LIST_PAGES,
  NEXT_PAGE_LINK_PATTERN,
  PAGINATION_LINK_HEADER,
} from "./constants.js";
import {
  GitHubReleaseAssetState,
  type IGitHubRelease,
  type ISelectNewestInstallableVersionParams,
  type IStudioReleaseRequirements,
} from "./types.js";

/**
 * Extract the runner version from a release tag on the given lane.
 * @param tag - Release tag (e.g., "electron-app-staging-v1.10.6").
 * @param releaseTagPrefix - The lane's tag prefix (e.g., "electron-app-staging-v").
 * @returns Version string (e.g., "1.10.6"), or null when the tag belongs to another lane.
 */
function extractVersionFromTag (tag: string, releaseTagPrefix: string): string | null {
  if (!tag.startsWith(releaseTagPrefix)) {
    return null;
  }
  const match = tag.slice(releaseTagPrefix.length).match(/^(\d+\.\d+\.\d+)$/);
  return match ? match[1] : null;
}

/**
 * Name every asset an install of this version downloads: the archive and the checksums,
 * plus the archive's signature bundle once the version is past the signed-from pin.
 */
function listRequiredAssetNames (params: { version: string; platformArchiveName: string; signedFromVersion: string }): string[] {
  const requiredAssetNames = [params.platformArchiveName, ELECTRON_APP_CHECKSUMS_ASSET_NAME];
  // Only the signature rule is read here; the checksum is already required as an asset above.
  const integrityPolicy = resolveIntegrityPolicy({
    version: params.version,
    signedFromVersion: params.signedFromVersion,
    expectedChecksum: "",
  });
  if (integrityPolicy.requiresSignature) {
    requiredAssetNames.push(params.platformArchiveName + SIGNATURE_BUNDLE_SUFFIX);
  }
  return requiredAssetNames;
}

function hasEveryRequiredAsset (params: { release: IGitHubRelease; requiredAssetNames: string[] }): boolean {
  const uploadedAssetNames = new Set(
    params.release.assets
      .filter((asset) => asset.state === GitHubReleaseAssetState.Uploaded)
      .map((asset) => asset.name),
  );
  return params.requiredAssetNames.every((assetName) => uploadedAssetNames.has(assetName));
}

/**
 * Choose the highest Studio version that is published, on the lane, and installable here.
 *
 * GitHub does not list releases in version order, so every entry is compared. A newer
 * release missing an asset the install downloads is passed over for the next one down.
 * @param params - The release list and what this machine needs from a release.
 * @returns The chosen version (e.g., "1.24.10"), or null when no release qualifies.
 */
export function selectNewestInstallableVersion (params: ISelectNewestInstallableVersionParams): string | null {
  let newestVersion: string | null = null;

  for (const release of params.releases) {
    if (release.draft) {
      continue;
    }

    const version = extractVersionFromTag(release.tag_name, params.releaseTagPrefix);
    if (!version || (newestVersion && compareVersions(version, newestVersion) <= 0)) {
      continue;
    }

    const requiredAssetNames = listRequiredAssetNames({
      version: version,
      platformArchiveName: params.platformArchiveName,
      signedFromVersion: params.signedFromVersion,
    });
    if (hasEveryRequiredAsset({ release: release, requiredAssetNames: requiredAssetNames })) {
      newestVersion = version;
    }
  }

  return newestVersion;
}

/**
 * Read the next page's URL from a `Link` response header.
 * @param linkHeader - The header's value, or null when the response has none.
 * @returns The next page's URL, or null on the last page.
 */
export function parseNextPageUrl (linkHeader: string | null): string | null {
  const nextPageMatch = linkHeader?.match(NEXT_PAGE_LINK_PATTERN);
  return nextPageMatch ? nextPageMatch[1] : null;
}

/**
 * Read every page of the Studio release list.
 * @returns Every release GitHub lists, in the API's own order.
 * @throws Error when a page cannot be read, or the list runs past {@link MAX_RELEASE_LIST_PAGES} pages.
 */
export async function fetchStudioReleases (): Promise<IGitHubRelease[]> {
  const releases: IGitHubRelease[] = [];
  let pageUrl: string | null = GITHUB_RELEASES_API;

  for (let pagesRead = 0; pageUrl; pagesRead++) {
    if (pagesRead === MAX_RELEASE_LIST_PAGES) {
      throw new Error(`The release list runs past ${MAX_RELEASE_LIST_PAGES} pages.`);
    }

    const response = await fetch(pageUrl, { headers: GITHUB_RELEASES_API_HEADERS });
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    releases.push(...(await response.json() as IGitHubRelease[]));
    pageUrl = parseNextPageUrl(response.headers.get(PAGINATION_LINK_HEADER));
  }

  return releases;
}

/**
 * Find the newest Studio version this machine can install from its lane, reading the live release list.
 * @param requirements - The lane and what this machine needs from a release.
 * @returns The chosen version (e.g., "1.24.10"), or null when no release qualifies.
 * @throws Error when the release list cannot be read.
 */
export async function resolveNewestInstallableVersion (requirements: IStudioReleaseRequirements): Promise<string | null> {
  return selectNewestInstallableVersion({
    releases: await fetchStudioReleases(),
    releaseTagPrefix: requirements.releaseTagPrefix,
    platformArchiveName: requirements.platformArchiveName,
    signedFromVersion: requirements.signedFromVersion,
  });
}
