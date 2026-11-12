import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  applyWatchHolds,
  findOwedWatchWork,
  heldPrNumbersIn,
  owedWorkInSlot,
  watchFollowThroughDecision,
} from "../../guardrails/watchFollowThrough.js";
import {
  OwedWatchWorkKind,
  WatchFollowThroughAction,
  type GuardrailState,
  type OwedWatchWork,
} from "../../guardrails/types.js";
import type { WatchPreferences } from "../../pr-watch/types.js";
import type { WatchSlotFixture } from "./support/types.js";
import { watchFixturePrUrl, watchSlotFiles } from "./support/watchSlotFixture.js";

const SESSION = "owner-session";
const HEAD = "1111111111111111111111111111111111111111";
const KEY = `${HEAD}..2222222222222222222222222222222222222222`;
const always: WatchPreferences = { autoRebase: "always", maxCatchUpRebases: 20 };
const SKILLS_DIR = fileURLToPath(new URL("../../../plugin/skills", import.meta.url));

function seedSlot(fixture: Partial<WatchSlotFixture>, slug = "repo-pr7"): { sessionsDir: string; slotPath: string } {
  const sessionsDir = mkdtempSync(join(tmpdir(), "follow-through-"));
  const slotPath = join(sessionsDir, slug);
  mkdirSync(slotPath, { recursive: true });
  const files = watchSlotFiles({ ownerSessionId: SESSION, prNumber: 7, headSha: HEAD, ...fixture });
  for (const [fileName, contents] of Object.entries(files)) writeFileSync(join(slotPath, fileName), contents);
  // The due record is the newest write unless a test says otherwise, as when the loop just observed it.
  const later = new Date(Date.now() + 1_000);
  utimesSync(join(slotPath, "watch-due.env"), later, later);
  return { sessionsDir: sessionsDir, slotPath: slotPath };
}

const owedIn = (fixture: Partial<WatchSlotFixture>, preferences = always, sessionId = SESSION): OwedWatchWork[] =>
  findOwedWatchWork(sessionId, preferences, seedSlot(fixture).sessionsDir);

const kindsOwed = (fixture: Partial<WatchSlotFixture>, preferences = always): OwedWatchWorkKind[] =>
  owedIn(fixture, preferences).map((work) => work.kind);

describe("owed rebase", () => {
  it("is owed on a stale branch with no rebase attempted, naming the PR and key", () => {
    expect(owedIn({ rebaseDueKey: KEY })).toEqual([
      { kind: OwedWatchWorkKind.Rebase, slug: "repo-pr7", prUrl: watchFixturePrUrl(7), prNumber: 7, dueOn: KEY },
    ]);
  });

  it("clears once a rebase cycle is recorded for the key", () => {
    expect(kindsOwed({ rebaseDueKey: KEY, lastSeenEntry: { conflict_resolve_attempts: { [KEY]: 1 } } })).toEqual([]);
  });

  // The hand-written escalation that silenced PR follow-through for a day.
  it("stays owed when the key is escalated with no attempt behind it", () => {
    expect(kindsOwed({ rebaseDueKey: KEY, lastSeenEntry: { conflict_escalated_keys: [KEY] } })).toEqual([
      OwedWatchWorkKind.Rebase,
    ]);
  });

  it("is not owed unless autoRebase is always", () => {
    expect(kindsOwed({ rebaseDueKey: KEY }, { autoRebase: "never", maxCatchUpRebases: 20 })).toEqual([]);
    expect(kindsOwed({ rebaseDueKey: KEY }, { maxCatchUpRebases: 20 })).toEqual([]);
  });

  it("is not owed once the catch-up budget is spent", () => {
    expect(kindsOwed({ rebaseDueKey: KEY, lastSeenEntry: { catch_up_rebases: 20 } })).toEqual([]);
  });
});

describe("owed fix-ci", () => {
  it("is owed on a red head with no fix attempted", () => {
    expect(owedIn({ ciRedHeadSha: HEAD })[0]).toMatchObject({ kind: OwedWatchWorkKind.FixCi, dueOn: HEAD });
  });

  it("clears once a fix-ci cycle — a re-run included — is recorded for the head", () => {
    expect(kindsOwed({ ciRedHeadSha: HEAD, lastSeenEntry: { ci_fix_attempts: { [HEAD]: 1 } } })).toEqual([]);
  });

  it("stays owed when the head is escalated with no attempt behind it", () => {
    expect(kindsOwed({ ciRedHeadSha: HEAD, lastSeenEntry: { ci_escalated_shas: [HEAD] } })).toEqual([OwedWatchWorkKind.FixCi]);
  });

  it("is owed whatever autoRebase says", () => {
    expect(kindsOwed({ ciRedHeadSha: HEAD }, { autoRebase: "never", maxCatchUpRebases: 20 })).toEqual([OwedWatchWorkKind.FixCi]);
  });
});

// A loop that already reported the comment leaves watch-reported.env past it, so
// only the gate still knows nobody answered it.
describe("owed review feedback", () => {
  const COMMENT = 6809364360;
  const unhandledEntry = { lastBodyReviewId: 0, lastConversationCommentId: 0 };

  it("is owed for a reported conversation comment last_seen.json never recorded handled", () => {
    expect(owedIn({ dueFeedback: { conversation: String(COMMENT) }, lastSeenEntry: unhandledEntry })).toEqual([
      {
        kind: OwedWatchWorkKind.ReviewFeedback,
        slug: "repo-pr7",
        prUrl: watchFixturePrUrl(7),
        prNumber: 7,
        dueOn: `reviews=[] conversation=[${COMMENT}]`,
      },
    ]);
  });

  it("clears once the cycle records the comment handled, or escalates it", () => {
    const dueFeedback = { conversation: String(COMMENT) };
    expect(kindsOwed({ dueFeedback: dueFeedback, lastSeenEntry: { ...unhandledEntry, lastConversationCommentId: COMMENT } })).toEqual([]);
    expect(
      kindsOwed({ dueFeedback: dueFeedback, lastSeenEntry: { ...unhandledEntry, escalated_conversation_comment_ids: [COMMENT] } }),
    ).toEqual([]);
  });

  it("owes a body-only review above lastBodyReviewId and clears it once the watermark reaches it", () => {
    expect(owedIn({ dueFeedback: { reviews: "41" }, lastSeenEntry: unhandledEntry })[0]?.dueOn).toBe("reviews=[41] conversation=[]");
    expect(kindsOwed({ dueFeedback: { reviews: "41" }, lastSeenEntry: { ...unhandledEntry, lastBodyReviewId: 41 } })).toEqual([]);
  });

  it("owes an unanswered thread until the watermark's COM passes its comment", () => {
    const threadSlot = { dueFeedback: { threads: "112:57" }, lastSeenEntry: unhandledEntry };
    expect(owedIn({ ...threadSlot, watermark: 'REV=0\nCOM=111\nCONV=0\nTHREADS=""\n' })[0]?.dueOn).toBe("reviews=[57] conversation=[]");
    expect(kindsOwed({ ...threadSlot, watermark: 'REV=0\nCOM=112\nCONV=0\nTHREADS=""\n' })).toEqual([]);
    expect(kindsOwed({ ...threadSlot, lastSeenEntry: { ...unhandledEntry, escalated_review_ids: [57] } })).toEqual([]);
  });

  // A reply is owed to the comment, so a push since the record does not excuse it.
  it("stays owed on a record a newer tick superseded with another head", () => {
    const { slotPath } = seedSlot({ dueFeedback: { conversation: String(COMMENT) }, lastSeenEntry: unhandledEntry });
    const prsPath = join(slotPath, "prs.json");
    const prs = JSON.parse(readFileSync(prsPath, "utf-8")) as Array<Record<string, unknown>>;
    writeFileSync(prsPath, JSON.stringify([{ ...prs[0], head_sha: "3333333333333333333333333333333333333333" }]));
    const evenLater = new Date(statSync(join(slotPath, "watch-due.env")).mtimeMs + 5_000);
    utimesSync(prsPath, evenLater, evenLater);
    expect(owedWorkInSlot(slotPath, "repo-pr7", SESSION, always).map((work) => work.kind)).toEqual([
      OwedWatchWorkKind.ReviewFeedback,
    ]);
  });
});

describe("owed pending wake", () => {
  const CONVERSATION_LINE = "EVENT pr=7 new conversation comment id=4410";

  it("is owed for a report queued while a fresh loop watches, naming its line", () => {
    const { sessionsDir, slotPath } = seedSlot({});
    writeFileSync(join(slotPath, "watch-service.queued.out"), `DRAIN pr=7 state=OPEN\n${CONVERSATION_LINE}\n`);
    expect(findOwedWatchWork(SESSION, always, sessionsDir)).toEqual([
      { kind: OwedWatchWorkKind.PendingWake, slug: "repo-pr7", prUrl: watchFixturePrUrl(7), prNumber: 7, dueOn: CONVERSATION_LINE },
    ]);
  });

  it("is owed for an exited service loop's report, alongside due CI work on another slot field", () => {
    const { sessionsDir, slotPath } = seedSlot({ ciRedHeadSha: HEAD });
    writeFileSync(join(slotPath, "watch-service.out"), "TERMINAL pr=7 state=MERGED\n");
    expect(findOwedWatchWork(SESSION, always, sessionsDir).map((work) => work.kind)).toEqual([
      OwedWatchWorkKind.PendingWake,
      OwedWatchWorkKind.FixCi,
    ]);
  });

  it("is not owed for a loop output with nothing for the owner, nor on another session's slot", () => {
    const { sessionsDir, slotPath } = seedSlot({});
    writeFileSync(join(slotPath, "watch-service.out"), "DRAIN pr=7 state=OPEN\nEXPIRED pr=7 watch lifetime reached\n");
    expect(findOwedWatchWork(SESSION, always, sessionsDir)).toEqual([]);
    writeFileSync(join(slotPath, "watch-service.queued.out"), `${CONVERSATION_LINE}\n`);
    expect(findOwedWatchWork("other-session", always, sessionsDir)).toEqual([]);
  });
});

describe("slots that owe this session nothing", () => {
  it("a PR whose forward stages are still in flight, though its watch saw work due", () => {
    const { sessionsDir, slotPath } = seedSlot({ rebaseDueKey: KEY, ciRedHeadSha: HEAD, lastSeenEntry: { forward_stages_in_flight: true } });
    writeFileSync(join(slotPath, "watch-service.queued.out"), "EVENT pr=7 checks settled red head=1111\n");
    expect(findOwedWatchWork(SESSION, always, sessionsDir)).toEqual([]);
  });

  it("another session's slot", () => {
    expect(owedIn({ rebaseDueKey: KEY }, always, "other-session")).toEqual([]);
  });

  it("a stopped slot", () => {
    const { sessionsDir } = seedSlot({ rebaseDueKey: KEY }, "repo-pr7.stopped");
    expect(findOwedWatchWork(SESSION, always, sessionsDir)).toEqual([]);
  });

  it("a finalized slot, and a slot whose PR went terminal", () => {
    const { sessionsDir, slotPath } = seedSlot({ rebaseDueKey: KEY });
    writeFileSync(join(slotPath, "result.md"), "# Result");
    expect(findOwedWatchWork(SESSION, always, sessionsDir)).toEqual([]);
    expect(owedIn({ rebaseDueKey: KEY, prState: "merged" })).toEqual([]);
  });

  it("a slot whose watch saw nothing due", () => {
    expect(owedIn({})).toEqual([]);
  });

  it("a missing sessions dir", () => {
    expect(findOwedWatchWork(SESSION, always, join(tmpdir(), "no-such-sessions-dir"))).toEqual([]);
  });

  // The head moved after the record: a tick refreshed prs.json since.
  it("a record superseded by a newer tick on another head", () => {
    const { slotPath } = seedSlot({ rebaseDueKey: KEY, ciRedHeadSha: HEAD });
    const prsPath = join(slotPath, "prs.json");
    const prs = JSON.parse(readFileSync(prsPath, "utf-8")) as Array<Record<string, unknown>>;
    writeFileSync(prsPath, JSON.stringify([{ ...prs[0], head_sha: "3333333333333333333333333333333333333333" }]));
    const evenLater = new Date(statSync(join(slotPath, "watch-due.env")).mtimeMs + 5_000);
    utimesSync(prsPath, evenLater, evenLater);
    expect(owedWorkInSlot(slotPath, "repo-pr7", SESSION, always)).toEqual([]);
  });

  it("keeps the record when the newer tick saw the same head", () => {
    const { slotPath } = seedSlot({ rebaseDueKey: KEY });
    const later = new Date(statSync(join(slotPath, "watch-due.env")).mtimeMs + 5_000);
    utimesSync(join(slotPath, "prs.json"), later, later);
    expect(owedWorkInSlot(slotPath, "repo-pr7", SESSION, always)).toHaveLength(1);
  });
});

const transcriptOf = (...entries: object[]): string => entries.map((entry) => JSON.stringify(entry)).join("\n");
const typed = (text: string) => ({ type: "user", origin: { kind: "human" }, message: { role: "user", content: text } });

describe("heldPrNumbersIn", () => {
  it("reads every hold the user typed", () => {
    expect(heldPrNumbersIn(transcriptOf(typed("HOLD WATCH #7 and HOLD WATCH #9 until I'm back")))).toEqual([7, 9]);
  });

  it("ignores the phrase from anyone but the user", () => {
    const transcript = transcriptOf(
      { type: "assistant", message: { role: "assistant", content: "Reply HOLD WATCH #7 to hold it." } },
      { type: "user", toolUseResult: {}, message: { role: "user", content: [{ type: "tool_result", content: "HOLD WATCH #7" }] } },
      { type: "user", isMeta: true, message: { role: "user", content: "HOLD WATCH #7" } },
      { type: "user", origin: { kind: "task-notification" }, message: { role: "user", content: "HOLD WATCH #7" } },
    );
    expect(heldPrNumbersIn(transcript)).toEqual([]);
  });

  it("ignores the placeholder the docs spell and a lowercase paraphrase", () => {
    expect(heldPrNumbersIn(transcriptOf(typed("type HOLD WATCH #<pr-number>"), typed("hold watch #7 please")))).toEqual([]);
  });
});

const baseState = (overrides: Partial<GuardrailState> = {}): GuardrailState => ({
  sessionId: SESSION,
  prsHandled: [],
  ...overrides,
});
const owedRebase: OwedWatchWork = { kind: OwedWatchWorkKind.Rebase, slug: "s", prUrl: "u", prNumber: 7, dueOn: KEY };

describe("watchFollowThroughDecision", () => {
  it("blocks on owed work and counts the block", () => {
    expect(watchFollowThroughDecision(baseState(), [owedRebase])).toEqual({
      action: WatchFollowThroughAction.Block,
      blockCount: 1,
      owed: [owedRebase],
    });
  });

  it("is quiet with nothing owed", () => {
    expect(watchFollowThroughDecision(baseState(), []).action).toBe(WatchFollowThroughAction.None);
  });

  it("drops work on a PR the user held", () => {
    expect(watchFollowThroughDecision(baseState({ watchHeldPrNumbers: [7] }), [owedRebase]).action).toBe(
      WatchFollowThroughAction.None,
    );
  });

  // Waiting out a reminder budget would be the same hold, taken by the session.
  it("never releases however many times it has blocked", () => {
    expect(watchFollowThroughDecision(baseState({ watchFollowThroughBlockCount: 50 }), [owedRebase])).toMatchObject({
      action: WatchFollowThroughAction.Block,
      blockCount: 51,
    });
  });
});

describe("applyWatchHolds", () => {
  it("returns the same reference when no hold is new", () => {
    const state = baseState({ watchHeldPrNumbers: [7] });
    expect(applyWatchHolds(state, [7])).toBe(state);
    expect(applyWatchHolds(state, [])).toBe(state);
    expect(applyWatchHolds(state, [9]).watchHeldPrNumbers).toEqual([7, 9]);
  });
});

function markdownFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? markdownFilesUnder(join(directory, entry.name))
      : entry.name.endsWith(".md")
        ? [join(directory, entry.name)]
        : [],
  );
}

// A skill's body reaches the transcript whenever it loads. Were one to spell a
// hold with a real number, the gate's user-turn filter would be the only thing
// between that doc and a forged hold.
describe("the shipped skills", () => {
  it("spell the hold only as a placeholder, never for a real PR", () => {
    const offending = markdownFilesUnder(SKILLS_DIR).filter((filePath) => /HOLD WATCH #\d/.test(readFileSync(filePath, "utf-8")));
    expect(offending).toEqual([]);
  });
});
