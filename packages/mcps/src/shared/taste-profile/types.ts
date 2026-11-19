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

/** Kind of work a taste belongs to; a consumer applies only its own discipline's taste plus General. Values match the prompt-service contract. */
export enum TasteDiscipline {
  /** Web application user interfaces. */
  WebUi = "WebUi",
  /** Native or mobile application user interfaces. */
  MobileApp = "MobileApp",
  /** Cutting, pacing and finishing video. */
  VideoEditing = "VideoEditing",
  /** Generated images and visual assets. */
  ImageGeneration = "ImageGeneration",
  /** Taste whose supporting signals span two or more disciplines. */
  General = "General",
}

/** One piece of evidence of taste, as written to the local journal. Never uploaded. */
export interface ITasteSignal {
  kind: TasteSignalKind;
  /** Discipline of the work the signal came from; a signal without one counts as WebUi. */
  discipline?: TasteDiscipline;
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

/** One signal a preference rests on, uploaded with it so the conclusion can be checked. */
export interface ITasteEvidence {
  kind: TasteSignalKind;
  /** Short excerpt of the signal in the user's own words; screened before upload. */
  excerpt: string;
  /** Where the signal came from, e.g. a PR or run reference. */
  sourceRef?: string;
  /** ISO-8601 time the signal was recorded. */
  recordedAt: string;
}

/** One distilled entry of the profile: the conclusion, where it holds, and what it rests on. */
export interface ITastePreference {
  /** The taste, phrased as guidance. */
  statement: string;
  /** The situation the conclusion was drawn from and where it holds; runs apply it only there. */
  appliesWhen: string;
  /** The newest supporting signals, newest first; one to three entries. */
  evidence: ITasteEvidence[];
  category: TasteCategory;
  /** Discipline the preference belongs to; a stored preference without one reads as WebUi. */
  discipline: TasteDiscipline;
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

/** A section whose statements, contexts and evidence excerpts exceed the character budget. */
export interface ITasteSectionBudgetViolation {
  /** `user` for the user-wide section, otherwise the project id. */
  sectionName: string;
  characterCount: number;
}

/** Result of screening one section before upload. */
export interface ITasteSectionScreenResult {
  screenedSection: ITasteSection;
  redactionCount: number;
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

/** What was last uploaded for one section. */
export interface ITasteSectionUploadState {
  /** ISO-8601 time the section was uploaded. */
  uploadedAt: string;
  /** Hash of the screened section's preferences as uploaded. */
  screenedSectionHash: string;
}

/** Upload state per section, keyed by `user` for the user-wide section or by project id. */
export type TasteUploadState = Record<string, ITasteSectionUploadState>;

/** How a local section compares with the copy last uploaded for it. */
export enum TasteSectionUploadStatus {
  /** The section has never been uploaded. */
  NeverUploaded = "never-uploaded",
  /** The screened local section matches what was uploaded. */
  MatchesUploadedCopy = "matches-uploaded-copy",
  /** The screened local section differs from what was uploaded. */
  ChangedSinceUpload = "changed-since-upload",
}

/**
 * Upload status of one local section.
 *
 * Output shape: `{ status: "changed-since-upload", uploadedAt: "2026-11-17T10:00:00.000Z" }`
 */
export interface ITasteSectionUploadReport {
  status: TasteSectionUploadStatus;
  /** Absent when the section has never been uploaded. */
  uploadedAt?: string;
}

/**
 * The local profile with each section's upload status and where its readable copy lives.
 *
 * Output shape: `{ tasteProfile: { userSection, projectSections }, sectionUploadReports: { user: { status: "never-uploaded" } }, viewPath: "/home/u/.muggle-ai/taste/profile.md" }`
 */
export interface ITasteProfileOverview {
  tasteProfile: ITasteProfile;
  sectionUploadReports: Record<string, ITasteSectionUploadReport>;
  viewPath: string;
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
