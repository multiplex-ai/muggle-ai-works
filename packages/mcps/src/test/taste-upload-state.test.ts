/** Tests for the taste upload state store and the per-section upload status. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TASTE_REDACTION_MARKER } from "../shared/taste-profile/constants.js";
import { getTasteUploadStatePath } from "../shared/taste-profile/taste-paths.js";
import { screenTasteProfile } from "../shared/taste-profile/taste-profile-screen.js";
import {
  clearTasteUploadState,
  readTasteUploadState,
  recordTasteSectionUploads,
} from "../shared/taste-profile/taste-upload-state-store.js";
import {
  buildTasteSectionUploadStates,
  hashScreenedTasteSection,
  resolveTasteProfileUploadReports,
} from "../shared/taste-profile/taste-upload-status.js";
import {
  TasteCategory,
  TasteDiscipline,
  TasteSectionUploadStatus,
  TasteSignalKind,
  type ITasteProfile,
  type ITasteSection,
} from "../shared/taste-profile/types.js";

const UPLOADED_AT = "2026-11-03T00:00:00.000Z";

function buildSection(statement: string, distilledAt: string = "2026-11-02T00:00:00.000Z"): ITasteSection {
  return {
    preferences: [
      {
        statement: statement,
        appliesWhen: "Settings page",
        evidence: [{ kind: TasteSignalKind.E2eFeedback, excerpt: "too cramped", recordedAt: "2026-11-01T00:00:00.000Z" }],
        category: TasteCategory.VisualDesign,
        discipline: TasteDiscipline.WebUi,
        signalCount: 2,
        lastSeenAt: "2026-11-01T00:00:00.000Z",
      },
    ],
    distilledAt: distilledAt,
  };
}

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "taste-upload-state-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("taste upload state store", () => {
  it("lives at taste/upload-state.json and reads empty when missing or corrupt", () => {
    expect(getTasteUploadStatePath(dataDir)).toBe(path.join(dataDir, "taste", "upload-state.json"));
    expect(readTasteUploadState(dataDir)).toEqual({});
    fs.mkdirSync(path.dirname(getTasteUploadStatePath(dataDir)), { recursive: true });
    fs.writeFileSync(getTasteUploadStatePath(dataDir), "{not json");
    expect(readTasteUploadState(dataDir)).toEqual({});
  });

  it("replaces uploaded sections, keeps the others, and clears", () => {
    recordTasteSectionUploads({ user: { uploadedAt: "t1", screenedSectionHash: "a" }, p1: { uploadedAt: "t1", screenedSectionHash: "b" } }, dataDir);
    recordTasteSectionUploads({ p1: { uploadedAt: "t2", screenedSectionHash: "c" } }, dataDir);

    expect(readTasteUploadState(dataDir)).toEqual({
      user: { uploadedAt: "t1", screenedSectionHash: "a" },
      p1: { uploadedAt: "t2", screenedSectionHash: "c" },
    });

    clearTasteUploadState(dataDir);
    expect(fs.existsSync(getTasteUploadStatePath(dataDir))).toBe(false);
  });
});

describe("taste section upload status", () => {
  it("reports never uploaded, matches uploaded copy, and changed since upload", () => {
    const uploadedProfile: ITasteProfile = { userSection: buildSection("Roomy forms"), projectSections: {} };
    const uploadState = buildTasteSectionUploadStates(screenTasteProfile(uploadedProfile).screenedProfile, UPLOADED_AT);

    const currentProfile: ITasteProfile = {
      userSection: buildSection("Roomy forms"),
      projectSections: { p1: buildSection("Never sent"), p2: buildSection("Changed") },
    };
    uploadState.p2 = { uploadedAt: UPLOADED_AT, screenedSectionHash: hashScreenedTasteSection(buildSection("Original")) };

    expect(resolveTasteProfileUploadReports(currentProfile, uploadState)).toEqual({
      user: { status: TasteSectionUploadStatus.MatchesUploadedCopy, uploadedAt: UPLOADED_AT },
      p1: { status: TasteSectionUploadStatus.NeverUploaded },
      p2: { status: TasteSectionUploadStatus.ChangedSinceUpload, uploadedAt: UPLOADED_AT },
    });
  });

  it("compares the screened section, so a redacted secret still matches its upload", () => {
    const sectionWithEmail = buildSection("Ping ops@example.com on failures");
    const uploadState = buildTasteSectionUploadStates(
      screenTasteProfile({ userSection: sectionWithEmail, projectSections: {} }).screenedProfile,
      UPLOADED_AT,
    );

    expect(screenTasteProfile({ userSection: sectionWithEmail, projectSections: {} }).screenedProfile.userSection?.preferences[0].statement).toContain(
      TASTE_REDACTION_MARKER,
    );
    expect(resolveTasteProfileUploadReports({ userSection: sectionWithEmail, projectSections: {} }, uploadState).user.status).toBe(
      TasteSectionUploadStatus.MatchesUploadedCopy,
    );
  });

  it("hashes preferences independent of key order and of distilledAt", () => {
    const section = buildSection("Roomy forms");
    const reorderedPreference = Object.fromEntries(Object.entries(section.preferences[0]).reverse());
    const reorderedSection = { ...buildSection("Roomy forms", "2026-11-09T00:00:00.000Z"), preferences: [reorderedPreference] } as ITasteSection;

    expect(hashScreenedTasteSection(reorderedSection)).toBe(hashScreenedTasteSection(section));
    expect(hashScreenedTasteSection(buildSection("Other"))).not.toBe(hashScreenedTasteSection(section));
  });
});