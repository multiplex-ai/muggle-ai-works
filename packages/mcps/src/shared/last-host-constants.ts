/** Constants for the last-used local dev server URL cache. */

import {
  CWD_KEYED_CACHE_VERSION,
  LEGACY_CACHE_DIR_NAME,
} from "./cwd-keyed-cache-constants.js";
import type { ICwdKeyedCache } from "./cwd-keyed-cache-types.js";

/** Cache file name, in the Muggle home directory. */
export const LAST_HOST_FILE_NAME = "last-host.json";

/** Directory of the superseded in-project cache. */
export const LAST_HOST_DIR_NAME = LEGACY_CACHE_DIR_NAME;

/** Schema version for future migrations. */
export const LAST_HOST_VERSION = CWD_KEYED_CACHE_VERSION;

/** Descriptor passed to the cwd-keyed cache store. */
export const LAST_HOST_CACHE: ICwdKeyedCache = {
  fileName: LAST_HOST_FILE_NAME,
  legacyEntryKey: "lastHost",
};
