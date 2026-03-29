/**
 * Cleanup command - removes old electron-app versions and obsolete skills to free disk space.
 */

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { homedir } from "os";
import * as path from "path";

import { getDataDir, getElectronAppVersion, getLogger } from "../../packages/mcps/src/index.js";

const logger = getLogger();

/** Subdirectory name for electron-app versions. */
const ELECTRON_APP_DIR = "electron-app";

/** Cursor skills directory path components. */
const CURSOR_SKILLS_DIR = ".cursor";
const CURSOR_SKILLS_SUBDIR = "skills";

/** Prefix for muggle skills. */
const MUGGLE_SKILL_PREFIX = "muggle";

/** Install manifest filename. */
const INSTALL_MANIFEST_FILE = "install-manifest.json";

/**
 * Options for the cleanup command.
 */
export interface ICleanupOptions {
  /** Remove all versions except current (default: keep current + 1 previous). */
  all?: boolean;
  /** Dry run - show what would be deleted without deleting. */
  dryRun?: boolean;
  /** Also clean up obsolete skills. */
  skills?: boolean;
}

/**
 * Installed version info.
 */
export interface IInstalledVersion {
  /** Version string. */
  version: string;
  /** Full path to version directory. */
  path: string;
  /** Size in bytes. */
  sizeBytes: number;
  /** Whether this is the current active version. */
  isCurrent: boolean;
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
 * Get the electron-app base directory.
 * @returns Path to ~/.muggle-ai/electron-app
 */
function getElectronAppBaseDir (): string {
  return path.join(getDataDir(), ELECTRON_APP_DIR);
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

      if (!entry.name.startsWith(MUGGLE_SKILL_PREFIX)) {
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
 * List all installed electron-app versions.
 * @returns Array of installed version info, sorted by version descending.
 */
export function listInstalledVersions (): IInstalledVersion[] {
  const baseDir = getElectronAppBaseDir();
  const currentVersion = getElectronAppVersion();
  const versions: IInstalledVersion[] = [];

  if (!existsSync(baseDir)) {
    return versions;
  }

  try {
    const entries = readdirSync(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      // Check if directory name looks like a version (e.g., "1.0.1")
      if (!/^\d+\.\d+\.\d+$/.test(entry.name)) {
        continue;
      }

      const versionPath = path.join(baseDir, entry.name);
      const sizeBytes = getDirectorySize(versionPath);

      versions.push({
        version: entry.name,
        path: versionPath,
        sizeBytes: sizeBytes,
        isCurrent: entry.name === currentVersion,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to list installed versions", { error: errorMessage });
  }

  // Sort by version descending (newest first)
  versions.sort((a, b) => compareVersions(b.version, a.version));

  return versions;
}

/**
 * Remove old electron-app versions.
 * @param options - Cleanup options.
 * @returns Object with removed versions and freed bytes.
 */
export function cleanupOldVersions (options: ICleanupOptions = {}): {
  removed: IInstalledVersion[];
  freedBytes: number;
} {
  const { all = false, dryRun = false } = options;
  const versions = listInstalledVersions();
  const removed: IInstalledVersion[] = [];
  let freedBytes = 0;

  // Determine which versions to keep
  // - Always keep current version
  // - By default, also keep one previous version (for rollback)
  // - With --all, only keep current

  const versionsToKeep = all ? 1 : 2;
  let keptCount = 0;

  for (const version of versions) {
    if (version.isCurrent) {
      keptCount++;
      continue;
    }

    if (keptCount < versionsToKeep) {
      keptCount++;
      continue;
    }

    // This version should be removed
    if (!dryRun) {
      try {
        rmSync(version.path, { recursive: true, force: true });
        logger.info("Removed old version", {
          version: version.version,
          freedBytes: version.sizeBytes,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Failed to remove version", {
          version: version.version,
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
 * Execute the versions command - list installed versions.
 */
export async function versionsCommand (): Promise<void> {
  console.log("\nInstalled Electron App Versions");
  console.log("================================\n");

  const versions = listInstalledVersions();

  if (versions.length === 0) {
    console.log("No versions installed.");
    console.log("Run 'muggle setup' to download the Electron app.\n");
    return;
  }

  let totalSize = 0;

  for (const version of versions) {
    const marker = version.isCurrent ? " (current)" : "";
    const size = formatBytes(version.sizeBytes);
    console.log(`  v${version.version}${marker} - ${size}`);
    totalSize += version.sizeBytes;
  }

  console.log("");
  console.log(`Total: ${versions.length} version(s), ${formatBytes(totalSize)}`);
  console.log("");
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

  const versions = listInstalledVersions();

  if (versions.length === 0) {
    console.log("No versions installed. Nothing to clean up.\n");
  } else if (versions.length === 1) {
    console.log("Only the current version is installed. Nothing to clean up.\n");
  } else {
    const currentVersion = versions.find((v) => v.isCurrent);
    const oldVersions = versions.filter((v) => !v.isCurrent);

    console.log(`Current version: v${currentVersion?.version ?? "unknown"}`);
    console.log(`Old versions: ${oldVersions.length}`);
    console.log("");

    if (options.dryRun) {
      console.log("Dry run - showing what would be deleted:\n");
    }

    const result = cleanupOldVersions(options);

    if (result.removed.length === 0) {
      if (options.all) {
        console.log("No old versions to remove.\n");
      } else {
        console.log("Keeping one previous version for rollback.");
        console.log("Use --all to remove all old versions.\n");
      }
    } else {
      console.log(options.dryRun ? "Would remove:" : "Removed:");

      for (const version of result.removed) {
        console.log(`  v${version.version} (${formatBytes(version.sizeBytes)})`);
      }

      totalFreedBytes += result.freedBytes;
      totalRemovedCount += result.removed.length;
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

