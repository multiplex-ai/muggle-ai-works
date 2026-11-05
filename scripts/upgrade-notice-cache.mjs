import { rmSync } from "fs";
import { join } from "path";

const UPGRADE_NOTICE_CACHE_FILE_NAMES = ["version-check", "upgrade-available"];

/**
 * Forget the cached version lookup, so a reminder to upgrade never outlives the upgrade.
 *
 * The cache names the build that was installed when it was written, which this install just replaced. A file that
 * cannot be removed is left for the next upkeep: a stale notice must not fail an install.
 *
 * @param {string} cacheDir - The ~/.cache/muggle directory.
 */
export function clearUpgradeNoticeCache(cacheDir) {
    for (const cacheFileName of UPGRADE_NOTICE_CACHE_FILE_NAMES) {
        try {
            rmSync(join(cacheDir, cacheFileName), { force: true });
        } catch {
            continue;
        }
    }
}
