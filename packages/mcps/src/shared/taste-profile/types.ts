/**
 * Shapes for the taste profile: the local signal journal and the distilled profile.
 */

/** Area of product taste a preference speaks to. Values match the prompt-service contract. */
export enum TasteCategory {
  /** How things are named: identifiers, labels, terminology. */
  Naming = "Naming",
  /** Layout, color, spacing, typography. */
  VisualDesign = "VisualDesign",
  /** How controls and flows behave. */
  Interaction = "Interaction",
  /** Wording and tone of user-facing text. */
  Copy = "Copy",
  /** How the team likes work to proceed: PRs, reviews, process. */
  Workflow = "Workflow",
  /** What the team counts as a defect. */
  QualityBar = "QualityBar",
}

/** Muggle flow a taste signal was captured from. */
export enum TasteSignalKind {
  /** A pull request review comment that a muggle-do cycle addressed. */
  ReviewComment = "ReviewComment",
  /** E2E feedback the user submitted on a generated test script. */
  E2eFeedback = "E2eFeedback",
  /** The goal and acceptance criteria of a request the user approved. */
  ApprovedRequest = "ApprovedRequest",
}

/** One piece of evidence of taste, as written to the local journal. Never uploaded. */
export interface ITasteSignal {
  kind: TasteSignalKind;
  /** The user's own words, or the approved goal and criteria. */
  text: string;
  /** Muggle Test project the signal belongs to; absent for a user-wide signal. */
  projectId?: string;
  /** How the flow classified the signal, e.g. a review comment's classification. */
  classification?: string;
  /** Where the signal came from, e.g. a PR or run reference. */
  sourceRef?: string;
  /** ISO-8601 time the signal was recorded. */
  recordedAt: string;
}

/** Fields a caller provides when appending a signal; `recordedAt` is stamped by the journal. */
export type TasteSignalInput = Omit<ITasteSignal, "recordedAt">;

/** Narrowing applied when listing journal signals. */
export interface ITasteSignalListFilter {
  projectId?: string;
  kind?: TasteSignalKind;
  /** Keep only the newest N signals. */
  limit?: number;
}

/** One distilled line of the profile. */
export interface ITastePreference {
  /** The taste, phrased as guidance. */
  statement: string;
  category: TasteCategory;
  /** Number of signals supporting the preference; at least 1. */
  signalCount: number;
  /** ISO-8601 time the newest supporting signal was seen. */
  lastSeenAt: string;
}

/** A user-wide or per-project block of preferences. */
export interface ITasteSection {
  preferences: ITastePreference[];
  /** ISO-8601 time the section was distilled. */
  distilledAt: string;
}

/** The whole profile: one user-wide section plus a section per Muggle Test project id. */
export interface ITasteProfile {
  userSection: ITasteSection | null;
  projectSections: Record<string, ITasteSection>;
}

/** Sections to replace in a profile; sections left out are kept. */
export interface ITasteProfileSectionUpdate {
  userSection?: ITasteSection;
  projectSections?: Record<string, ITasteSection>;
}

/** A section whose statements exceed the character budget. */
export interface ITasteSectionBudgetViolation {
  /** `user` for the user-wide section, otherwise the project id. */
  sectionName: string;
  statementCharacterCount: number;
}

/**
 * Result of screening a profile before upload.
 *
 * Output shape: `{ screenedProfile: { userSection, projectSections }, redactionCount: 2 }`
 */
export interface ITasteProfileScreenResult {
  screenedProfile: ITasteProfile;
  redactionCount: number;
}

/** What the upload gate decided for one upload attempt. */
export enum TasteProfileUploadDecision {
  /** Upload now. */
  Upload = "upload",
  /** The preference is `ask` and the user has not approved this upload. */
  NeedsConsent = "needs-consent",
  /** The preference is `never`. */
  Refuse = "refuse",
}
