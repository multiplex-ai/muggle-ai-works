/** What init did about the CI check in the repository it ran in. */
export enum CiOfferOutcome {
  Installed = "installed",
  Declined = "declined",
  /** `ask`, on a surface with nobody to ask — the user is pointed at `muggle ci-install`. */
  Deferred = "deferred",
  /** `never` — left alone without a word. */
  TurnedOff = "turned-off",
  AlreadyInstalled = "already-installed",
  /** An unedited copy from an earlier release was replaced with the current workflow. */
  Updated = "updated",
  NotApplicable = "not-applicable",
}

/** Asks one question and resolves to the raw answer. */
export type AskQuestion = (question: string) => Promise<string>;
