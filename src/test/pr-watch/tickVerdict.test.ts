import { describe, expect, it } from "vitest";
import { resolveArmFloorEvidence } from "../../pr-watch/armFloors.js";
import { isRebaseBudgetExhausted } from "../../pr-watch/attempts.js";
import { resolveWatchTickVerdict } from "../../pr-watch/tickVerdict.js";
import {
  CiRollupBucket,
  WatchTickVerdict,
  type LastSeenPrEntry,
  type WatchPreferences,
  type WatchTickObservation,
} from "../../pr-watch/types.js";

const HEAD = "head1";
const KEY = "head1..base1";
const defaults: WatchPreferences = { autoRebase: "always", maxCatchUpRebases: 20 };

const observe = (overrides: Partial<WatchTickObservation> = {}): WatchTickObservation => ({
  headSha: HEAD,
  rebaseKey: KEY,
  isRebaseDue: false,
  ciBucket: CiRollupBucket.Green,
  ...overrides,
});

const verdictFor = (entry: LastSeenPrEntry, overrides: Partial<WatchTickObservation> = {}, preferences = defaults) =>
  resolveWatchTickVerdict(entry, observe(overrides), preferences);

describe("resolveWatchTickVerdict: a due rebase", () => {
  it("dispatches when nothing was attempted", () => {
    expect(verdictFor({}, { isRebaseDue: true })).toBe(WatchTickVerdict.DispatchRebase);
  });

  // The defect: a session wrote the key into conflict_escalated_keys without
  // rebasing, and the tick read the entry as a reason never to dispatch.
  it("dispatches anyway when the key is escalated with no attempt behind it", () => {
    expect(verdictFor({ conflict_escalated_keys: [KEY] }, { isRebaseDue: true })).toBe(WatchTickVerdict.DispatchRebase);
    expect(
      verdictFor({ conflict_escalated_keys: [KEY], conflict_resolve_attempts: { [KEY]: 0 } }, { isRebaseDue: true }),
    ).toBe(WatchTickVerdict.DispatchRebase);
  });

  it("holds on a key a rebase cycle actually escalated", () => {
    const escalated: LastSeenPrEntry = { conflict_escalated_keys: [KEY], conflict_resolve_attempts: { [KEY]: 1 } };
    expect(verdictFor(escalated, { isRebaseDue: true })).toBe(WatchTickVerdict.BlockConflictEscalated);
  });

  it("dispatches a second attempt, then stops at the per-key budget", () => {
    expect(verdictFor({ conflict_resolve_attempts: { [KEY]: 1 } }, { isRebaseDue: true })).toBe(
      WatchTickVerdict.DispatchRebase,
    );
    expect(verdictFor({ conflict_resolve_attempts: { [KEY]: 2 } }, { isRebaseDue: true })).toBe(WatchTickVerdict.Idle);
  });

  it("ignores a legacy bare-SHA escalation entry", () => {
    expect(
      verdictFor({ conflict_escalated_keys: [HEAD], conflict_resolve_attempts: { [HEAD]: 1 } }, { isRebaseDue: true }),
    ).toBe(WatchTickVerdict.DispatchRebase);
  });

  it("blocks once the PR spent its catch-up budget, judged from the counter", () => {
    expect(verdictFor({ catch_up_rebases: 20 }, { isRebaseDue: true })).toBe(WatchTickVerdict.BlockRebaseBudgetExhausted);
    expect(verdictFor({ catch_up_rebases: 20 }, { isRebaseDue: true }, { maxCatchUpRebases: null })).toBe(
      WatchTickVerdict.DispatchRebase,
    );
  });

  // A flag the session wrote, or one left behind after the owner raised the cap,
  // must not stop a rebase the counter still has budget for.
  it("does not let the exhausted flag alone suppress a rebase", () => {
    expect(verdictFor({ rebase_budget_exhausted: true, catch_up_rebases: 3 }, { isRebaseDue: true })).toBe(
      WatchTickVerdict.DispatchRebase,
    );
  });

  it("falls through to CI once the per-key budget is spent", () => {
    expect(
      verdictFor({ conflict_resolve_attempts: { [KEY]: 2 } }, { isRebaseDue: true, ciBucket: CiRollupBucket.Red }),
    ).toBe(WatchTickVerdict.DispatchFixCi);
  });
});

describe("resolveWatchTickVerdict: red CI", () => {
  it("dispatches fix-ci on a red head nothing tried to fix", () => {
    expect(verdictFor({}, { ciBucket: CiRollupBucket.Red })).toBe(WatchTickVerdict.DispatchFixCi);
  });

  it("dispatches anyway when the head is escalated with no fix attempt behind it", () => {
    expect(verdictFor({ ci_escalated_shas: [HEAD] }, { ciBucket: CiRollupBucket.Red })).toBe(
      WatchTickVerdict.DispatchFixCi,
    );
  });

  it("holds on a head fix-ci actually escalated", () => {
    expect(
      verdictFor({ ci_escalated_shas: [HEAD], ci_fix_attempts: { [HEAD]: 1 } }, { ciBucket: CiRollupBucket.Red }),
    ).toBe(WatchTickVerdict.BlockCiEscalated);
  });

  it("idles once the per-head budget is spent without an escalation entry", () => {
    expect(verdictFor({ ci_fix_attempts: { [HEAD]: 3 } }, { ciBucket: CiRollupBucket.Red })).toBe(WatchTickVerdict.Idle);
  });

  it("idles while checks are pending or green", () => {
    expect(verdictFor({}, { ciBucket: CiRollupBucket.Pending })).toBe(WatchTickVerdict.Idle);
    expect(verdictFor({}, { ciBucket: CiRollupBucket.Green })).toBe(WatchTickVerdict.Idle);
  });

  it("prefers a due rebase to a red head", () => {
    expect(verdictFor({}, { isRebaseDue: true, ciBucket: CiRollupBucket.Red })).toBe(WatchTickVerdict.DispatchRebase);
  });
});

describe("resolveWatchTickVerdict: idle blocks", () => {
  it("blocks on an escalated review when nothing else applies", () => {
    expect(verdictFor({ escalated_review_ids: [7] })).toBe(WatchTickVerdict.BlockReviewsEscalated);
  });

  it("idles with nothing recorded", () => {
    expect(verdictFor({})).toBe(WatchTickVerdict.Idle);
  });
});

describe("isRebaseBudgetExhausted", () => {
  it("ignores a counter that is not a number", () => {
    expect(isRebaseBudgetExhausted({ catch_up_rebases: "99" as unknown as number }, 20)).toBe(false);
  });
});

describe("resolveArmFloorEvidence", () => {
  const CAP = 20;

  it("reports only attempts recorded for this key and this head", () => {
    const entry: LastSeenPrEntry = {
      conflict_resolve_attempts: { [KEY]: 1, "other..base": 4 },
      ci_fix_attempts: { other: 2 },
      conflict_escalated_keys: ["head1..base9"],
    };
    expect(resolveArmFloorEvidence(entry, HEAD, KEY, CAP)).toEqual({
      isRebaseKeyAttempted: true,
      isCiHeadAttempted: false,
      isRebaseBudgetExhausted: false,
      blockedCiDigest: "",
    });
  });

  // An escalation entry is not an attempt, so it can never floor anything.
  it("does not count an escalation entry as an attempt", () => {
    const entry: LastSeenPrEntry = { conflict_escalated_keys: [KEY], ci_escalated_shas: [HEAD] };
    expect(resolveArmFloorEvidence(entry, HEAD, KEY, CAP)).toMatchObject({
      isRebaseKeyAttempted: false,
      isCiHeadAttempted: false,
    });
  });

  // The same counter check the tick verdict blocks on, so arm and tick never disagree about a spent budget.
  it("reports the catch-up rebase budget spent once the counter reaches the cap", () => {
    expect(resolveArmFloorEvidence({ catch_up_rebases: 19 }, HEAD, KEY, CAP).isRebaseBudgetExhausted).toBe(false);
    expect(resolveArmFloorEvidence({ catch_up_rebases: 20 }, HEAD, KEY, CAP).isRebaseBudgetExhausted).toBe(true);
    expect(resolveArmFloorEvidence({ catch_up_rebases: 20, rebase_budget_exhausted: true }, HEAD, KEY, 21).isRebaseBudgetExhausted).toBe(
      false,
    );
    expect(resolveArmFloorEvidence({ catch_up_rebases: 500 }, HEAD, KEY, null).isRebaseBudgetExhausted).toBe(false);
  });

  it("drops a blocked digest spanning lines", () => {
    expect(resolveArmFloorEvidence({ blocked: { fingerprint: { ci_digest: "a\nREV=9" } } }, HEAD, KEY, CAP).blockedCiDigest).toBe(
      "",
    );
    expect(
      resolveArmFloorEvidence({ blocked: { fingerprint: { ci_digest: "a:SUCCESS" } } }, HEAD, KEY, CAP).blockedCiDigest,
    ).toBe("a:SUCCESS");
  });
});
