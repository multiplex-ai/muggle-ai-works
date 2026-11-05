/**
 * Directory under the data dir where a download waits until it is accepted. Kept out of
 * `electron-app/` so nothing that lists installs can mistake it for one, and the same
 * length as that name, so extracting here cannot cross the Windows path limit the real
 * install stays under.
 */
export const STUDIO_STAGING_DIR_NAME = "studio-stage";

/** Suffix of the directory an install moves to while its replacement moves in. */
export const RETIRED_INSTALL_SUFFIX = ".retired";

/** Attempts at moving a directory; Windows antivirus briefly locks freshly extracted files. */
export const INSTALL_MOVE_MAX_ATTEMPTS = 10;

/** Delay between attempts at moving a directory. */
export const INSTALL_MOVE_RETRY_DELAY_MS = 500;

/** Errors a held file produces on Windows, the only ones worth retrying a move for. */
export const INSTALL_MOVE_RETRYABLE_ERROR_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
