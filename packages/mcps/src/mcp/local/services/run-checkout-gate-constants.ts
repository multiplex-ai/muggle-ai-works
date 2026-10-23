/** Constants for the local-run checkout gate. */

/** Hostnames served from this machine — the only run targets whose checkout the gate can judge. */
export const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"];

/** Suffix of the reserved `*.localhost` names, which also resolve to this machine. */
export const LOCALHOST_DOMAIN_SUFFIX = ".localhost";

/** First octet-dot of the IPv4 loopback block 127.0.0.0/8. */
export const IPV4_LOOPBACK_PREFIX = "127.";
