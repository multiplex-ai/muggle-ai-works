import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Outcome of a backfill attempt.
 * @typedef {object} BackfillResult
 * @property {boolean} stamped - Whether a completion stamp was written.
 * @property {string} reason - Why the attempt ended the way it did.
 */

/**
 * Mark an existing installation as having already seen the first-run walkthrough.
 *
 * Postinstall runs before any `muggle setup`, so the preferences file exists at this
 * moment only for someone who has already used Muggle. Stamping them here reserves the
 * walkthrough for genuinely new installs, which have no file yet.
 *
 * @param {string} dataDir - The ~/.muggle-ai directory.
 * @param {Date} [now] - Stamp timestamp; defaults to the current time.
 * @returns {BackfillResult} What happened, for the caller to log.
 */
export function backfillOnboardingStamp(dataDir, now = new Date()) {
    const preferencesPath = join(dataDir, "preferences.json");

    if (!existsSync(preferencesPath)) {
        return { stamped: false, reason: "new installation" };
    }

    let preferencesFile;
    try {
        preferencesFile = JSON.parse(readFileSync(preferencesPath, "utf-8"));
    } catch (error) {
        return { stamped: false, reason: `unreadable preferences file: ${error.message}` };
    }

    if (typeof preferencesFile.onboardingCompletedAt === "string" && preferencesFile.onboardingCompletedAt.length > 0) {
        return { stamped: false, reason: "already stamped" };
    }

    preferencesFile.onboardingCompletedAt = now.toISOString();

    try {
        writeFileSync(preferencesPath, `${JSON.stringify(preferencesFile, null, 2)}\n`, "utf-8");
    } catch (error) {
        return { stamped: false, reason: `could not write preferences file: ${error.message}` };
    }

    return { stamped: true, reason: "existing installation" };
}
