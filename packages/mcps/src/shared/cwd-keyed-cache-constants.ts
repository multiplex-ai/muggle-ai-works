/** Constants shared by every cwd-keyed cache. */

/** Schema version stamped on cwd-keyed cache files. */
export const CWD_KEYED_CACHE_VERSION = 1;

/** Directory holding the superseded in-project cache files. */
export const LEGACY_CACHE_DIR_NAME = ".muggle-ai";

/**
 * Home location as written for humans, for tool descriptions and result lines.
 * The resolved path comes from `getDataDir()`; this is the tilde form a user
 * reads, and it is a constant so the two never drift apart across call sites.
 */
export const MUGGLE_HOME_DISPLAY_DIR = "~/.muggle-ai";
