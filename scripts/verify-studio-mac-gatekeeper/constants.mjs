/** `checksumsByStream` platform keys of the macOS studio archives Gatekeeper assesses. */
export const MAC_PLATFORM_KEYS = ["darwin-arm64", "darwin-x64"];

/** App bundle a macOS studio archive extracts to. */
export const MAC_APP_BUNDLE_NAME = "MuggleAI.app";

/** Extended attribute macOS sets on a downloaded file, which is what makes Gatekeeper assess it. */
export const QUARANTINE_ATTRIBUTE_NAME = "com.apple.quarantine";

/** Quarantine flags a browser download records. */
export const QUARANTINE_FLAGS = "0081";

/** Downloading agent recorded in the simulated quarantine attribute. */
export const QUARANTINE_AGENT_NAME = "Safari";

/** Abort budget for downloading one studio archive (roughly 350 MB). */
export const ARCHIVE_DOWNLOAD_TIMEOUT_MS = 600_000;
