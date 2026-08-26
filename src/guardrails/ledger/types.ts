/** Which provider a thread came from; selects the identifier the reply call targets. */
export enum LedgerProvider {
  GitHub = "github",
  GitLab = "gitlab",
}

/** The worker holding a thread while it works the obligation. */
export interface Claimant {
  sessionId: string;
  pid: number;
  host: string;
  claimedAt: string;
}

/** One thread's obligation record. */
export interface ThreadEntry {
  provider: LedgerProvider;
  generation: number;
  humanCommentIds: string[];
  coveredCommentIds: string[];
  claim: Claimant | null;
  lastClaimedBySessionId: string | null;
  lastReplySha: string | null;
  updatedAt: string;
}

/** The per-pull-request ledger file's shape. */
export interface Ledger {
  version: number;
  threads: Record<string, ThreadEntry>;
}

/** Derived from an entry's fields, never stored — a stored copy could disagree with what it summarizes. */
export enum ThreadState {
  Unprocessed = "unprocessed",
  Processing = "processing",
  Processed = "processed",
}
