/** What the init walkthrough's CI question resolved to. */
export enum CiOfferOutcome {
  Installed = "installed",
  Declined = "declined",
  AlreadyInstalled = "already-installed",
  NotApplicable = "not-applicable",
}

/** Asks one question and resolves to the raw answer. */
export type AskQuestion = (question: string) => Promise<string>;
