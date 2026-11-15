/** Candidate count at which a local scan stops when `--max-candidates` is not given. */
export const DEFAULT_LOCAL_SCAN_MAX_CANDIDATES = 30;

/** Log threshold while `muggle local scan` runs, so only the report reaches the terminal. */
export const LOCAL_SCAN_COMMAND_LOG_LEVEL = "warn";

/** Discovery-memory status of a candidate a reviewer rejected; never reported. */
export const DROPPED_CANDIDATE_STATUS = "dropped";

/** Text in a candidate that marks its flow as running signed in. */
export const SIGNED_IN_FLOW_PATTERN =
  /\b(log ?in|logs in|logged[ -]in|logging in|sign[ -]?in|signs in|signed[ -]in|signing in|authenticated)\b/i;
