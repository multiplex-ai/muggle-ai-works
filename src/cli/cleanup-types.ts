import type { ElectronAppReleaseStream } from "../../packages/mcps/src/index.js";

/** What an entry under `~/.muggle-ai/electron-app` is on disk. */
export enum ElectronAppInstallKind {
  /** A real directory holding a studio build. */
  Directory = "directory",
  /** A link whose target directory exists; the runtime launches through it. */
  Link = "link",
  /** A link whose target is gone; nothing can launch from it. */
  BrokenLink = "broken-link",
}

/**
 * Options for the cleanup command.
 */
export interface ICleanupOptions {
  /** Remove every old version of the active stream (default: keep the active one + 1 previous). */
  all?: boolean;
  /** Dry run - show what would be deleted without deleting. */
  dryRun?: boolean;
  /** Also clean up obsolete skills. */
  skills?: boolean;
}

/**
 * One studio install directory, or link to one, under `~/.muggle-ai/electron-app`.
 */
export interface IInstalledVersion {
  /** Entry name, for example "1.13.9" or "1.13.9-staging". */
  directoryName: string;
  /** Version string. */
  version: string;
  /** Release stream the directory name places this install in. */
  releaseStream: ElectronAppReleaseStream;
  /** Full path to version directory. */
  path: string;
  /** Whether the entry is a directory, a live link, or a broken link. */
  kind: ElectronAppInstallKind;
  /** Where the link points, as stored in the link; set only for links. */
  linkTarget?: string;
  /** Size in bytes; 0 for links, whose bytes belong to their target. */
  sizeBytes: number;
  /** Whether this is the directory the runtime launches the studio from. */
  isActive: boolean;
}

/**
 * Obsolete skill info.
 */
export interface IObsoleteSkill {
  /** Skill directory name. */
  name: string;
  /** Full path to skill directory. */
  path: string;
  /** Size in bytes. */
  sizeBytes: number;
}
