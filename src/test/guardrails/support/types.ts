/** A gate wrapper's payload pre-filter, modelled in TypeScript so it can be checked on every platform. */
export interface WrapperPrefilter {
  /** Whether the wrapper's pre-filter would start Node for this hook payload (its JSON text). */
  test(payloadJson: string): boolean;
}

/** What a muggle-do watch slot fixture records: its owner, its PR, the due work its watch saw, and its attempt ledger. */
export interface WatchSlotFixture {
  ownerSessionId: string;
  prNumber: number;
  headSha: string;
  /** `open` unless a test needs a terminal slot. */
  prState?: string;
  rebaseDueKey?: string;
  ciRedHeadSha?: string;
  /** The PR's `last_seen.json` entry. */
  lastSeenEntry?: Record<string, unknown>;
}

/** A child_process call whose options do not carry an inline `windowsHide: true`. */
export interface UnhiddenSpawnCall {
  file: string;
  line: number;
  callee: string;
}
