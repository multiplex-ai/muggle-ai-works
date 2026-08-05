/** Constants for the last-used Muggle Test project cache. */

import {
  CWD_KEYED_CACHE_VERSION,
  LEGACY_CACHE_DIR_NAME,
} from "./cwd-keyed-cache-constants.js";
import type { ICwdKeyedCache } from "./cwd-keyed-cache-types.js";

/** Cache file name, in the Muggle home directory. */
export const LAST_PROJECT_FILE_NAME = "last-project.json";

/** Directory of the superseded in-project cache. */
export const LAST_PROJECT_DIR_NAME = LEGACY_CACHE_DIR_NAME;

/** Schema version for future migrations. */
export const LAST_PROJECT_VERSION = CWD_KEYED_CACHE_VERSION;

/** Descriptor passed to the cwd-keyed cache store. */
export const LAST_PROJECT_CACHE: ICwdKeyedCache = {
  fileName: LAST_PROJECT_FILE_NAME,
  legacyEntryKey: "lastProject",
};
