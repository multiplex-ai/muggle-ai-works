import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readFileTail, userAuthoredText, userAuthoredTextsContaining } from "../../transcript/userTurns.js";

const PHRASE = "HOLD WATCH #12";

// Entry shapes as Claude Code writes them; each non-typed one carries the phrase
// the way an agent could get it there.
const typedPrompt = { type: "user", origin: { kind: "human" }, message: { role: "user", content: `ok, ${PHRASE} for now` } };
const legacyPrompt = { type: "user", message: { role: "user", content: PHRASE } };
const typedWithImage = {
  type: "user",
  origin: { kind: "human" },
  message: { role: "user", content: [{ type: "image" }, { type: "text", text: PHRASE }] },
};
const toolResult = {
  type: "user",
  toolUseResult: { stdout: PHRASE },
  message: { role: "user", content: [{ type: "tool_result", content: PHRASE }] },
};
const skillBody = { type: "user", isMeta: true, message: { role: "user", content: [{ type: "text", text: PHRASE }] } };
const hookFeedback = { type: "user", isMeta: true, message: { role: "user", content: `Stop hook feedback: ${PHRASE}` } };
const taskNotification = {
  type: "user",
  origin: { kind: "task-notification" },
  message: { role: "user", content: `<task-notification>${PHRASE}</task-notification>` },
};
const peerMessage = { type: "user", isMeta: true, origin: { kind: "peer" }, message: { role: "user", content: PHRASE } };
const compactSummary = { type: "user", isCompactSummary: true, message: { role: "user", content: PHRASE } };
const subagentPrompt = { type: "user", isSidechain: true, message: { role: "user", content: PHRASE } };
const assistantTurn = { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: PHRASE }] } };

describe("userAuthoredText", () => {
  it.each([
    ["a typed prompt", typedPrompt],
    ["a prompt from a version that stamps no origin", legacyPrompt],
    ["a typed prompt with a pasted image", typedWithImage],
  ])("reads %s", (_label, entry) => {
    expect(userAuthoredText(entry)).toContain(PHRASE);
  });

  it.each([
    ["a tool result", toolResult],
    ["a loaded skill body", skillBody],
    ["a hook's block reason", hookFeedback],
    ["a background task notification", taskNotification],
    ["another agent's message", peerMessage],
    ["a compaction summary", compactSummary],
    ["a subagent's prompt", subagentPrompt],
    ["an assistant turn", assistantTurn],
  ])("rejects %s", (_label, entry) => {
    expect(userAuthoredText(entry)).toBeNull();
  });
});

describe("userAuthoredTextsContaining", () => {
  it("returns only the typed turns naming the literal, skipping lines that do not parse", () => {
    const transcript = [typedPrompt, toolResult, skillBody, assistantTurn]
      .map((entry) => JSON.stringify(entry))
      .concat(['{"type":"user", truncated', JSON.stringify(legacyPrompt)])
      .join("\n");
    expect(userAuthoredTextsContaining(transcript, PHRASE)).toEqual([`ok, ${PHRASE} for now`, PHRASE]);
  });
});

describe("readFileTail", () => {
  it("returns the last bytes of a file, and the whole of a short one", () => {
    const filePath = join(mkdtempSync(join(tmpdir(), "transcript-")), "t.jsonl");
    writeFileSync(filePath, "0123456789");
    expect(readFileTail(filePath, 4)).toBe("6789");
    expect(readFileTail(filePath, 100)).toBe("0123456789");
  });

  it("is null for a file it cannot read", () => {
    expect(readFileTail(join(tmpdir(), "no-such-transcript.jsonl"), 10)).toBeNull();
  });
});
