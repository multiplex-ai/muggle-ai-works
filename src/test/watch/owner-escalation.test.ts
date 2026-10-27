import { describe, expect, it } from "vitest";
import { resolveOwnerEscalation } from "../../watch/owner-escalation.js";
import { OwnerEscalationKind } from "../../watch/types.js";

const PR = { repo: "o/r", number: 702, url: "https://github.com/o/r/pull/702" };
const HEAD = "a8c83fe8e64ef534ccb9957e97921bcfe3595309";

function lastSeenFor(entry: Record<string, unknown>): string {
  return JSON.stringify({ "o/r#702": entry });
}

describe("resolveOwnerEscalation", () => {
  it("counts a CI escalation on the live head only when a fix-ci cycle ran for it", () => {
    const escalated = lastSeenFor({ ci_fix_attempts: { [HEAD]: 1 }, ci_escalated_shas: [HEAD] });
    expect(resolveOwnerEscalation(escalated, [], PR, HEAD)).toEqual({ kinds: [OwnerEscalationKind.Ci] });
    expect(resolveOwnerEscalation(escalated, [], PR, "f".repeat(40))).toBeUndefined();
    expect(resolveOwnerEscalation(lastSeenFor({ ci_escalated_shas: [HEAD] }), [], PR, HEAD)).toBeUndefined();
  });

  it("counts a conflict escalated on any base tip paired with the live head", () => {
    const escalated = lastSeenFor({
      conflict_resolve_attempts: { [`${HEAD}..base1`]: 1, [`old..base2`]: 1 },
      conflict_escalated_keys: [`${HEAD}..base1`, "old..base2", HEAD],
    });
    expect(resolveOwnerEscalation(escalated, [], PR, HEAD)?.kinds).toEqual([OwnerEscalationKind.Conflict]);
    expect(resolveOwnerEscalation(escalated, [], PR, "old")?.kinds).toEqual([OwnerEscalationKind.Conflict]);
    expect(resolveOwnerEscalation(escalated, [], PR, "new")).toBeUndefined();
  });

  it("counts escalated reviews whatever the head, and every kind together", () => {
    const escalated = lastSeenFor({
      ci_fix_attempts: { [HEAD]: 1 },
      ci_escalated_shas: [HEAD],
      conflict_resolve_attempts: { [`${HEAD}..base1`]: 1 },
      conflict_escalated_keys: [`${HEAD}..base1`],
      escalated_review_ids: [5662648409],
    });
    expect(resolveOwnerEscalation(escalated, [], PR, HEAD)?.kinds).toEqual([
      OwnerEscalationKind.Ci,
      OwnerEscalationKind.Conflict,
      OwnerEscalationKind.Reviews,
    ]);
    expect(resolveOwnerEscalation(escalated, [], PR, undefined)?.kinds).toEqual([OwnerEscalationKind.Reviews]);
  });

  it("quotes the PR's latest escalation line without its timestamp, cut to the note limit", () => {
    const escalated = lastSeenFor({ escalated_review_ids: [1] });
    const followupLogLines = [
      "2026-10-27T08:10:20Z fix-ci pr=702 head=a8c8 escalated: awaiting owner decision",
      "2026-10-27T09:00:00Z fix-ci pr=7020 escalated: another PR",
      "2026-10-27T09:01:00Z tick pr=702 idle",
      "",
    ];
    expect(resolveOwnerEscalation(escalated, followupLogLines, PR, HEAD)?.note).toBe(
      "fix-ci pr=702 head=a8c8 escalated: awaiting owner decision",
    );
    const longNote = resolveOwnerEscalation(escalated, [`t conflict pr=702 escalated: ${"x".repeat(300)}`], PR, HEAD)?.note ?? "";
    expect(longNote).toHaveLength(200);
    expect(longNote.endsWith("…")).toBe(true);
    expect(resolveOwnerEscalation(escalated, ["t tick pr=702 idle"], PR, HEAD)).toEqual({ kinds: [OwnerEscalationKind.Reviews] });
  });

  it("reads missing or malformed slot files as nothing escalated", () => {
    expect(resolveOwnerEscalation("", [], PR, HEAD)).toBeUndefined();
    expect(resolveOwnerEscalation("{not json", [], PR, HEAD)).toBeUndefined();
    expect(resolveOwnerEscalation(lastSeenFor({ conflict_escalated_keys: "nope", escalated_review_ids: "abc" }), [], PR, HEAD)).toBeUndefined();
    expect(resolveOwnerEscalation(lastSeenFor({ conflict_escalated_keys: [7, null] }), [], PR, HEAD)).toBeUndefined();
  });
});
