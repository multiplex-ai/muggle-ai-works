/** Upload state GitHub reports for a release asset. */
export enum GitHubReleaseAssetState {
  /** The upload finished, so the asset can be downloaded. */
  Uploaded = "uploaded",
  /** The upload is still in progress. */
  Open = "open",
}

/** A file attached to a GitHub release; only the fields the pick reads. */
export interface IGitHubReleaseAsset {
  name: string;
  state: GitHubReleaseAssetState;
}

/** A GitHub release as the releases API lists it; only the fields the pick reads. */
export interface IGitHubRelease {
  tag_name: string;
  draft: boolean;
  assets: IGitHubReleaseAsset[];
}

/** What a Studio release must satisfy to be installable on this machine. */
export interface IStudioReleaseRequirements {
  /** Tag prefix of the CLI's release lane, e.g. "electron-app-v" or "electron-app-staging-v". */
  releaseTagPrefix: string;
  /** This platform's archive, e.g. "MuggleAI-win32-x64.zip". */
  platformArchiveName: string;
  /** First Studio version published with a signature bundle. */
  signedFromVersion: string;
}

/** Inputs for choosing the newest installable Studio release from a list already read. */
export interface ISelectNewestInstallableVersionParams extends IStudioReleaseRequirements {
  releases: readonly IGitHubRelease[];
}
