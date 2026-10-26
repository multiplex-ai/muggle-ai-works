/** Types for the optimistic generation store at {@link ./generation-store.ts}. */

/** A committed record together with the generation it was read at. */
export interface IGenerationSnapshot<TRecord> {
  /** Generation number; 0 when nothing was ever committed. A commit expects it unchanged. */
  generation: number;
  record: TRecord;
}

/**
 * One step of an optimistic update: the record to commit next, or null to
 * commit nothing, plus the value handed back to the caller either way.
 */
export interface IGenerationUpdate<TRecord, TResult> {
  next: TRecord | null;
  result: TResult;
}

/** Outcome of {@link updateGenerationStore}. */
export interface IGenerationUpdateOutcome<TResult> {
  /** False only when every attempt lost the race to another writer. */
  isCommitted: boolean;
  /** Generation the final decision was made against, or committed as. */
  generation: number;
  result: TResult;
}
