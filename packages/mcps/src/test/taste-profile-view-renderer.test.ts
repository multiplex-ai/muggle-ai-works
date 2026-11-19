/** Tests for the readable taste profile rendering. */

import { describe, expect, it } from "vitest";

import { renderTasteProfileView } from "../shared/taste-profile/taste-profile-view-renderer.js";
import {
  TasteCategory,
  TasteDiscipline,
  TasteSectionUploadStatus,
  TasteSignalKind,
  type ITastePreference,
  type ITasteSection,
} from "../shared/taste-profile/types.js";

function buildPreference(statement: string, discipline: TasteDiscipline): ITastePreference {
  return {
    statement: statement,
    appliesWhen: "Dashboard toolbar",
    evidence: [
      {
        kind: TasteSignalKind.ReviewComment,
        excerpt: "move it to the right",
        sourceRef: "https://github.com/acme/app/pull/1",
        recordedAt: "2026-11-01T00:00:00.000Z",
      },
    ],
    category: TasteCategory.VisualDesign,
    discipline: discipline,
    signalCount: 4,
    lastSeenAt: "2026-11-01T00:00:00.000Z",
  };
}

function buildSection(preferences: ITastePreference[]): ITasteSection {
  return { preferences: preferences, distilledAt: "2026-11-02T00:00:00.000Z" };
}

describe("renderTasteProfileView", () => {
  it("renders the user-wide section, then each project, grouped by discipline in enum order", () => {
    const viewText = renderTasteProfileView(
      {
        userSection: buildSection([
          buildPreference("General taste", TasteDiscipline.General),
          buildPreference("Web taste", TasteDiscipline.WebUi),
        ]),
        projectSections: { p1: buildSection([buildPreference("App taste", TasteDiscipline.MobileApp)]) },
      },
      {},
    );

    const headingOrder = ["## User-wide", "### Web UI", "#### Web taste", "### General", "#### General taste", "## Project p1", "### Mobile app", "#### App taste"];
    const headingPositions = headingOrder.map((heading) => viewText.indexOf(heading));
    expect(headingPositions.every((position) => position >= 0)).toBe(true);
    expect([...headingPositions].sort((left, right) => left - right)).toEqual(headingPositions);
    expect(viewText).not.toContain("### Video editing");
  });

  it("shows each preference's context, category, support, last seen and evidence", () => {
    const viewText = renderTasteProfileView(
      { userSection: buildSection([buildPreference("Primary actions sit bottom-right", TasteDiscipline.WebUi)]), projectSections: {} },
      {},
    );

    expect(viewText).toContain("- Applies when: Dashboard toolbar");
    expect(viewText).toContain("- Category: VisualDesign");
    expect(viewText).toContain("- Signals: 4");
    expect(viewText).toContain("- Last seen: 2026-11-01T00:00:00.000Z");
    expect(viewText).toContain(
      '  - "move it to the right" (ReviewComment, 2026-11-01T00:00:00.000Z, https://github.com/acme/app/pull/1)',
    );
  });

  it.each([
    [undefined, "Last uploaded: never uploaded"],
    [{ status: TasteSectionUploadStatus.NeverUploaded }, "Last uploaded: never uploaded"],
    [
      { status: TasteSectionUploadStatus.MatchesUploadedCopy, uploadedAt: "2026-11-03T00:00:00.000Z" },
      "Last uploaded: 2026-11-03T00:00:00.000Z — matches uploaded copy",
    ],
    [
      { status: TasteSectionUploadStatus.ChangedSinceUpload, uploadedAt: "2026-11-03T00:00:00.000Z" },
      "Last uploaded: 2026-11-03T00:00:00.000Z — changed since upload",
    ],
  ])("labels upload state %o as %s", (uploadReport, expectedLine) => {
    const viewText = renderTasteProfileView(
      { userSection: buildSection([buildPreference("x", TasteDiscipline.WebUi)]), projectSections: {} },
      uploadReport === undefined ? {} : { user: uploadReport },
    );

    expect(viewText).toContain(expectedLine);
  });

  it("says the profile is empty when it has no sections", () => {
    expect(renderTasteProfileView({ userSection: null, projectSections: {} }, {})).toContain("No sections yet.");
  });
});