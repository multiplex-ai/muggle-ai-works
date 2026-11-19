/** Tests for the taste profile service: the readable copy follows every set, upload and clear. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getTasteProfilePath, getTasteProfileViewPath, getTasteUploadStatePath } from "../shared/taste-profile/taste-paths.js";
import { screenTasteProfile } from "../shared/taste-profile/taste-profile-screen.js";
import {
  clearLocalTasteProfile,
  getLocalTasteProfileOverview,
  recordTasteProfileUploadAndRender,
  setLocalTasteProfileSections,
} from "../shared/taste-profile/taste-profile-service.js";
import { writeTasteProfileSections } from "../shared/taste-profile/taste-profile-store.js";
import { readTasteUploadState } from "../shared/taste-profile/taste-upload-state-store.js";
import {
  TasteCategory,
  TasteDiscipline,
  TasteSectionUploadStatus,
  TasteSignalKind,
  type ITasteSection,
} from "../shared/taste-profile/types.js";

const UPLOADED_AT = "2026-11-03T00:00:00.000Z";

function buildSection(statement: string): ITasteSection {
  return {
    preferences: [
      {
        statement: statement,
        appliesWhen: "Settings page",
        evidence: [{ kind: TasteSignalKind.ReviewComment, excerpt: "e", recordedAt: "2026-11-01T00:00:00.000Z" }],
        category: TasteCategory.Copy,
        discipline: TasteDiscipline.WebUi,
        signalCount: 2,
        lastSeenAt: "2026-11-01T00:00:00.000Z",
      },
    ],
    distilledAt: "2026-11-02T00:00:00.000Z",
  };
}

function readView(): string {
  return fs.readFileSync(getTasteProfileViewPath(dataDir), "utf-8");
}

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "taste-service-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("taste profile service", () => {
  it("renders profile.md beside profile.json on every set", () => {
    setLocalTasteProfileSections({ userSection: buildSection("Sentence case buttons") }, dataDir);
    expect(getTasteProfileViewPath(dataDir)).toBe(path.join(dataDir, "taste", "profile.md"));
    expect(readView()).toContain("#### Sentence case buttons");
    expect(readView()).toContain("Last uploaded: never uploaded");

    setLocalTasteProfileSections({ projectSections: { p1: buildSection("Plural table names") } }, dataDir);
    expect(readView()).toContain("## Project p1");
  });

  it("leaves profile.md alone when only the store writes", () => {
    writeTasteProfileSections({ userSection: buildSection("u") }, dataDir);
    expect(fs.existsSync(getTasteProfileViewPath(dataDir))).toBe(false);
  });

  it("records an upload, re-renders as matching, then flags a later change", () => {
    setLocalTasteProfileSections({ userSection: buildSection("Roomy forms") }, dataDir);

    recordTasteProfileUploadAndRender(screenTasteProfile(getLocalTasteProfileOverview(dataDir).tasteProfile).screenedProfile, UPLOADED_AT, dataDir);
    expect(readTasteUploadState(dataDir).user.uploadedAt).toBe(UPLOADED_AT);
    expect(readView()).toContain(`Last uploaded: ${UPLOADED_AT} — matches uploaded copy`);
    expect(getLocalTasteProfileOverview(dataDir).sectionUploadReports.user).toEqual({
      status: TasteSectionUploadStatus.MatchesUploadedCopy,
      uploadedAt: UPLOADED_AT,
    });

    setLocalTasteProfileSections({ userSection: buildSection("Cramped forms") }, dataDir);
    expect(readView()).toContain(`Last uploaded: ${UPLOADED_AT} — changed since upload`);
  });

  it("re-renders without a project after clearing only that project", () => {
    setLocalTasteProfileSections({ userSection: buildSection("u"), projectSections: { p1: buildSection("a") } }, dataDir);

    clearLocalTasteProfile("p1", dataDir);

    expect(readView()).not.toContain("## Project p1");
    expect(readView()).toContain("## User-wide");
  });

  it("removes profile.json, profile.md and upload-state.json on a full clear", () => {
    setLocalTasteProfileSections({ userSection: buildSection("u") }, dataDir);
    recordTasteProfileUploadAndRender(getLocalTasteProfileOverview(dataDir).tasteProfile, UPLOADED_AT, dataDir);

    clearLocalTasteProfile(undefined, dataDir);

    expect(fs.existsSync(getTasteProfilePath(dataDir))).toBe(false);
    expect(fs.existsSync(getTasteProfileViewPath(dataDir))).toBe(false);
    expect(fs.existsSync(getTasteUploadStatePath(dataDir))).toBe(false);
  });
});