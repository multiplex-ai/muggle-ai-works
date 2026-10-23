/**
 * Cleanup command - removes old electron-app versions and obsolete skills to free disk space.
 */

import {
  type Dirent,
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
} from "fs";
import { homedir } from "os";
import * as path from "path";
import { fileURLToPath } from "url";

import {
  ElectronAppReleaseStream,
  getActiveElectronAppReleaseStream,
  getDataDir,
  getElectronAppDir,
  getLogger,
  parseElectronAppDirName,
} from "../../packages/mcps/src/index.js";
import {
  ElectronAppInstallKind,
  type ICleanupOptions,
  type IInstalledVersion,
  type IObsoleteSkill,
} from "./cleanup-types.js";

const logger = getLogger();

/** Cursor skills directory path components. */
const CURSOR_SKILLS_DIR = ".cursor";
const CURSOR_SKILLS_SUBDIR = "skills";

/** Prefix for muggle skills. */
const MUGGLE_SKILL_PREFIX = "muggle";

/**
 * Resolve the muggle alias-skill manifest. The file ships under `plugin/skills/` so it
 * is reachable from both this source location (`src/cli/`) and the bundled output (`dist/`)
 * by walking up to the package root. Single source of truth shared with
 * scripts/postinstall.mjs.
 */
function loadMuggleAliasSkills (): Set<string> {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.dirname(dir)) {
    const manifestPath = path.join(dir, "plugin", "skills", "_aliases.json");
    if (existsSync(manifestPath)) {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf-8")) as { aliases: string[] };
      return new Set<string>(parsed.aliases);
    }
    dir = path.dirname(dir);
  }
  throw new Error("Could not locate plugin/skills/_aliases.json relative to cleanup module");
}

const MUGGLE_ALIAS_SKILLS = loadMuggleAliasSkills();

/** Install manifest filename. */
const INSTALL_MANIFEST_FILE = "install-manifest.json";

/**
 * Install manifest structure.
 */
interface IInstallManifest {
  /** Package version that was installed. */
  packageVersion?: string;
  /** List of skill directory names that were installed. */
  skills?: string[];
  /** ISO timestamp of installation. */
  installedAt?: string;
}

/**
 * Get the electron-app base directory: the parent of the install the runtime launches.
 * @returns Path to ~/.muggle-ai/electron-app
 */
function getElectronAppBaseDir (): string {
  return path.dirname(getElectronAppDir());
}

/**
 * Get the Cursor skills directory.
 * @returns Path to ~/.cursor/skills
 */
function getCursorSkillsDir (): string {
  return path.join(homedir(), CURSOR_SKILLS_DIR, CURSOR_SKILLS_SUBDIR);
}

/**
 * Get the install manifest path.
 * @returns Path to ~/.muggle-ai/install-manifest.json
 */
function getInstallManifestPath (): string {
  return path.join(getDataDir(), INSTALL_MANIFEST_FILE);
}

/**
 * Read the install manifest from disk.
 * @returns Parsed manifest or null if not found/invalid.
 */
function readInstallManifest (): IInstallManifest | null {
  const manifestPath = getInstallManifestPath();

  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(content) as unknown;

    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
      return null;
    }

    return manifest as IInstallManifest;
  } catch {
    return null;
  }
}

/**
 * List obsolete muggle skills that are installed but not in the current manifest.
 * @returns Array of obsolete skill info.
 */
export function listObsoleteSkills (): IObsoleteSkill[] {
  const skillsDir = getCursorSkillsDir();
  const manifest = readInstallManifest();
  const obsoleteSkills: IObsoleteSkill[] = [];

  if (!existsSync(skillsDir)) {
    return obsoleteSkills;
  }

  const manifestSkills = new Set(manifest?.skills ?? []);

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (!entry.name.startsWith(MUGGLE_SKILL_PREFIX) && !MUGGLE_ALIAS_SKILLS.has(entry.name)) {
        continue;
      }

      if (manifestSkills.has(entry.name)) {
        continue;
      }

      const skillPath = path.join(skillsDir, entry.name);
      const sizeBytes = getDirectorySize(skillPath);

      obsoleteSkills.push({
        name: entry.name,
        path: skillPath,
        sizeBytes: sizeBytes,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to list obsolete skills", { error: errorMessage });
  }

  return obsoleteSkills;
}

/**
 * Remove obsolete skills.
 * @param options - Cleanup options.
 * @returns Object with removed skills and freed bytes.
 */
export function cleanupObsoleteSkills (options: { dryRun?: boolean } = {}): {
  removed: IObsoleteSkill[];
  freedBytes: number;
} {
  const { dryRun = false } = options;
  const obsoleteSkills = listObsoleteSkills();
  const removed: IObsoleteSkill[] = [];
  let freedBytes = 0;

  for (const skill of obsoleteSkills) {
    if (!dryRun) {
      try {
        rmSync(skill.path, { recursive: true, force: true });
        logger.info("Removed obsolete skill", {
          skill: skill.name,
          freedBytes: skill.sizeBytes,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Failed to remove skill", {
          skill: skill.name,
          error: errorMessage,
        });
        continue;
      }
    }

    removed.push(skill);
    freedBytes += skill.sizeBytes;
  }

  return { removed: removed, freedBytes: freedBytes };
}

/**
 * Calculate directory size recursively.
 * @param dirPath - Path to directory.
 * @returns Size in bytes.
 */
function getDirectorySize (dirPath: string): number {
  let totalSize = 0;

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        totalSize += getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        try {
          const stats = statSync(fullPath);
          totalSize += stats.size;
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Return 0 if we can't read the directory
  }

  return totalSize;
}

/**
 * Format bytes as human-readable string.
 * @param bytes - Size in bytes.
 * @returns Formatted string (e.g., "150 MB").
 */
export function formatBytes (bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);

  return `${size.toFixed(1)} ${units[i]}`;
}

/**
 * Compare semver versions.
 * @param a - First version.
 * @param b - Second version.
 * @returns Negative if a < b, positive if a > b, 0 if equal.
 */
function compareVersions (a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const partA = partsA[i] || 0;
    const partB = partsB[i] || 0;

    if (partA !== partB) {
      return partA - partB;
    }
  }

  return 0;
}

/**
 * Order installs by release stream, then newest version first within a stream.
 * @param first - First install.
 * @param second - Second install.
 * @returns Negative when `first` lists before `second`.
 */
function compareInstallsByStreamThenVersion (first: IInstalledVersion, second: IInstalledVersion): number {
  const releaseStreams = Object.values(ElectronAppReleaseStream);
  const streamOrder =
    releaseStreams.indexOf(first.releaseStream) - releaseStreams.indexOf(second.releaseStream);
  if (streamOrder !== 0) {
    return streamOrder;
  }
  return compareVersions(second.version, first.version);
}

/**
 * Classify an electron-app entry as a directory, a live link, or a broken link.
 * @param entry - Directory entry, typed without following links.
 * @param entryPath - Full path to the entry.
 * @returns The entry's kind, or null when it is neither a directory nor a link.
 */
function resolveInstallKind (entry: Dirent, entryPath: string): ElectronAppInstallKind | null {
  if (entry.isDirectory()) {
    return ElectronAppInstallKind.Directory;
  }
  if (!entry.isSymbolicLink()) {
    return null;
  }
  try {
    return statSync(entryPath).isDirectory() ? ElectronAppInstallKind.Link : ElectronAppInstallKind.BrokenLink;
  } catch {
    return ElectronAppInstallKind.BrokenLink;
  }
}

/**
 * Read where a link points, as stored in the link.
 * @param linkPath - Path to the link.
 * @returns The stored target, or undefined when it cannot be read.
 */
function readLinkTarget (linkPath: string): string | undefined {
  try {
    return readlinkSync(linkPath);
  } catch {
    return undefined;
  }
}

/**
 * Resolve a path through every link to the directory it lands on.
 * @param entryPath - Path to resolve.
 * @returns The canonical path, or the input when it cannot be resolved.
 */
function resolveCanonicalPath (entryPath: string): string {
  try {
    return realpathSync.native(entryPath);
  } catch {
    return entryPath;
  }
}

/**
 * List every studio install under `~/.muggle-ai/electron-app`, across release streams.
 *
 * Entry names are classified by {@link parseElectronAppDirName}, the inverse of
 * the rule the runtime uses to pick its install directory, so a staging install
 * (`1.13.13-staging`) lists alongside production ones (`1.13.9`). Links are
 * listed too, since the runtime launches through a live one.
 * @returns Installs grouped by release stream, newest version first within each.
 *
 * Output shape: `[{ directoryName: "1.13.13-staging", version: "1.13.13", releaseStream: "staging",
 * kind: "directory", sizeBytes: 502792192, isActive: true, path: "..." }]`
 */
export function listInstalledVersions (): IInstalledVersion[] {
  const baseDir = getElectronAppBaseDir();
  const activeDirectoryName = path.basename(getElectronAppDir());
  const versions: IInstalledVersion[] = [];

  if (!existsSync(baseDir)) {
    return versions;
  }

  try {
    const entries = readdirSync(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      const installDirName = parseElectronAppDirName(entry.name);
      if (!installDirName) {
        continue;
      }

      const versionPath = path.join(baseDir, entry.name);
      const installKind = resolveInstallKind(entry, versionPath);
      if (!installKind) {
        continue;
      }

      const isDirectory = installKind === ElectronAppInstallKind.Directory;

      versions.push({
        directoryName: entry.name,
        version: installDirName.version,
        releaseStream: installDirName.releaseStream,
        path: versionPath,
        kind: installKind,
        linkTarget: isDirectory ? undefined : readLinkTarget(versionPath),
        sizeBytes: isDirectory ? getDirectorySize(versionPath) : 0,
        isActive: entry.name === activeDirectoryName,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to list installed versions", { error: errorMessage });
  }

  versions.sort(compareInstallsByStreamThenVersion);

  return versions;
}

/**
 * Select the real install directories of one release stream, which are all cleanup may delete.
 * @param installs - Installs from {@link listInstalledVersions}.
 * @param releaseStream - Stream to select.
 * @returns That stream's directories, in listing order.
 */
function selectStreamDirectories (
  installs: IInstalledVersion[],
  releaseStream: ElectronAppReleaseStream,
): IInstalledVersion[] {
  return installs.filter(
    (install) => install.releaseStream === releaseStream && install.kind === ElectronAppInstallKind.Directory,
  );
}

/**
 * Resolve the directories that live links land on, in any stream.
 * @param installs - Installs from {@link listInstalledVersions}.
 * @returns Canonical paths of every live link's target.
 */
function resolveLinkedDirectoryPaths (installs: IInstalledVersion[]): Set<string> {
  return new Set(
    installs
      .filter((install) => install.kind === ElectronAppInstallKind.Link)
      .map((install) => resolveCanonicalPath(install.path)),
  );
}

/**
 * Remove old electron-app versions of the active release stream.
 *
 * Only real directories in the active stream are candidates. The other stream's
 * installs, every link, and any directory a live link lands on are kept: the
 * other stream's CLI launches its own runner, and deleting a link's target
 * would break whatever launches through that link — including the active one.
 * @param options - Cleanup options.
 * @returns Object with removed versions and freed bytes.
 */
export function cleanupOldVersions (options: ICleanupOptions = {}): {
  removed: IInstalledVersion[];
  freedBytes: number;
} {
  const { all = false, dryRun = false } = options;
  const installs = listInstalledVersions();
  const linkedDirectoryPaths = resolveLinkedDirectoryPaths(installs);
  const removed: IInstalledVersion[] = [];
  let freedBytes = 0;

  // The active version always stays; by default one previous version stays too, for rollback.
  const versionsToKeep = all ? 1 : 2;
  let keptCount = 0;

  for (const version of selectStreamDirectories(installs, getActiveElectronAppReleaseStream())) {
    if (version.isActive) {
      keptCount++;
      continue;
    }

    if (linkedDirectoryPaths.has(resolveCanonicalPath(version.path))) {
      continue;
    }

    if (keptCount < versionsToKeep) {
      keptCount++;
      continue;
    }

    if (!dryRun) {
      try {
        rmSync(version.path, { recursive: true, force: true });
        logger.info("Removed old version", {
          version: version.directoryName,
          freedBytes: version.sizeBytes,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Failed to remove version", {
          version: version.directoryName,
          error: errorMessage,
        });
        continue;
      }
    }

    removed.push(version);
    freedBytes += version.sizeBytes;
  }

  return { removed: removed, freedBytes: freedBytes };
}

/**
 * Format an install's version and release stream.
 * @param install - Install to label.
 * @returns Label such as "v1.13.13 [staging]".
 */
function formatInstallLabel (install: IInstalledVersion): string {
  return `v${install.version} [${install.releaseStream}]`;
}

/**
 * Format where a link points.
 * @param install - Link install.
 * @returns The stored target, or a placeholder when it could not be read.
 */
function formatLinkTarget (install: IInstalledVersion): string {
  return install.linkTarget ?? "(unreadable target)";
}

/**
 * Format one line of the versions listing.
 * @param install - Directory or live link.
 * @returns Line such as "v1.13.13 [staging] (active) - 479.5 MB".
 */
function formatInstallListing (install: IInstalledVersion): string {
  const activeMarker = install.isActive ? " (active)" : "";
  const location =
    install.kind === ElectronAppInstallKind.Link
      ? `-> ${formatLinkTarget(install)}`
      : `- ${formatBytes(install.sizeBytes)}`;
  return `${formatInstallLabel(install)}${activeMarker} ${location}`;
}

/**
 * Execute the versions command - list installed versions.
 */
export async function versionsCommand (): Promise<void> {
  console.log("\nInstalled Electron App Versions");
  console.log("================================\n");

  const installs = listInstalledVersions();
  const launchableInstalls = installs.filter((install) => install.kind !== ElectronAppInstallKind.BrokenLink);
  const brokenLinks = installs.filter((install) => install.kind === ElectronAppInstallKind.BrokenLink);

  if (launchableInstalls.length === 0) {
    console.log("No versions installed.");
    console.log("Run 'muggle setup' to download the Electron app.\n");
  } else {
    for (const install of launchableInstalls) {
      console.log(`  ${formatInstallListing(install)}`);
    }

    const directories = launchableInstalls.filter(
      (install) => install.kind === ElectronAppInstallKind.Directory,
    );
    const totalSize = directories.reduce((sizeSoFar, install) => sizeSoFar + install.sizeBytes, 0);

    console.log("");
    console.log(`Total: ${directories.length} version(s), ${formatBytes(totalSize)}`);
    console.log("");
  }

  if (brokenLinks.length > 0) {
    console.log("Broken links (target missing; nothing launches from them):");
    for (const brokenLink of brokenLinks) {
      const activeMarker = brokenLink.isActive ? " (active)" : "";
      console.log(`  ${brokenLink.directoryName}${activeMarker} -> ${formatLinkTarget(brokenLink)}`);
    }
    console.log("");
  }
}

/**
 * Execute the cleanup command.
 * @param options - Command options.
 */
export async function cleanupCommand (options: ICleanupOptions): Promise<void> {
  let totalFreedBytes = 0;
  let totalRemovedCount = 0;

  // Clean up electron app versions
  console.log("\nElectron App Cleanup");
  console.log("====================\n");

  const activeReleaseStream = getActiveElectronAppReleaseStream();
  const streamDirectories = selectStreamDirectories(listInstalledVersions(), activeReleaseStream);

  if (streamDirectories.length === 0) {
    console.log(`No ${activeReleaseStream} versions installed. Nothing to clean up.\n`);
  } else if (streamDirectories.length === 1) {
    console.log(`Only one ${activeReleaseStream} version is installed. Nothing to clean up.\n`);
  } else {
    const activeVersion = streamDirectories.find((v) => v.isActive);
    const oldVersions = streamDirectories.filter((v) => !v.isActive);

    console.log(`Active version: ${activeVersion ? formatInstallLabel(activeVersion) : "unknown"}`);
    console.log(`Old ${activeReleaseStream} versions: ${oldVersions.length}`);
    console.log("Other release streams and linked installs are left alone.");
    console.log("");

    if (options.dryRun) {
      console.log("Dry run - showing what would be deleted:\n");
    }

    const versionCleanupOutcome = cleanupOldVersions(options);

    if (versionCleanupOutcome.removed.length === 0) {
      if (options.all) {
        console.log("No old versions to remove.\n");
      } else {
        console.log("Keeping one previous version for rollback.");
        console.log("Use --all to remove all old versions.\n");
      }
    } else {
      console.log(options.dryRun ? "Would remove:" : "Removed:");

      for (const version of versionCleanupOutcome.removed) {
        console.log(`  ${formatInstallLabel(version)} (${formatBytes(version.sizeBytes)})`);
      }

      totalFreedBytes += versionCleanupOutcome.freedBytes;
      totalRemovedCount += versionCleanupOutcome.removed.length;
      console.log("");
    }
  }

  // Clean up obsolete skills if requested
  if (options.skills) {
    console.log("Skills Cleanup");
    console.log("==============\n");

    const obsoleteSkills = listObsoleteSkills();

    if (obsoleteSkills.length === 0) {
      console.log("No obsolete skills found. Nothing to clean up.\n");
    } else {
      console.log(`Found ${obsoleteSkills.length} obsolete skill(s):\n`);

      if (options.dryRun) {
        console.log("Dry run - showing what would be deleted:\n");
      }

      const skillResult = cleanupObsoleteSkills({ dryRun: options.dryRun });

      console.log(options.dryRun ? "Would remove:" : "Removed:");

      for (const skill of skillResult.removed) {
        console.log(`  ${skill.name} (${formatBytes(skill.sizeBytes)})`);
      }

      totalFreedBytes += skillResult.freedBytes;
      totalRemovedCount += skillResult.removed.length;
      console.log("");
    }
  }

  // Summary
  if (totalRemovedCount > 0) {
    console.log(
      `${options.dryRun ? "Would free" : "Freed"}: ${formatBytes(totalFreedBytes)} total`,
    );
    console.log("");

    if (options.dryRun) {
      console.log("Run without --dry-run to actually delete.\n");
    }
  }

  logger.info("Cleanup completed", {
    removed: totalRemovedCount,
    freedBytes: totalFreedBytes,
    dryRun: options.dryRun,
    includeSkills: options.skills,
  });
}
