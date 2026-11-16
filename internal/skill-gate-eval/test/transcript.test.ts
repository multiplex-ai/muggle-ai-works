import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { TRANSCRIPT_VERDICT_EVENT } from "../src/constants.js";
import { openRepTranscript, transcriptPathFor } from "../src/transcript.js";
import type { RunVerdict } from "../src/types.js";

describe("rep transcripts", () => {
  it("names one file per scenario and rep, safe on any filesystem", () => {
    expect(transcriptPathFor("/t", "always-shows-browser", 3)).toBe(join("/t", "always-shows-browser.rep3.jsonl"));
    expect(transcriptPathFor("/t", "ask: a/b", 1)).toBe(join("/t", "ask__a_b.rep1.jsonl"));
  });

  it("holds every event in order, then the verdict, one JSON object per line", () => {
    const transcriptPath = join(mkdtempSync(join(tmpdir(), "gate-transcript-")), "nested", "s.rep1.jsonl");
    const transcript = openRepTranscript(transcriptPath);
    transcript.appendEvent({ type: "thread.started", thread_id: "t1" });
    transcript.appendEvent({ type: "item.completed", item: { type: "agent_message", text: "Which use case?\n1. Sign up" } });
    const repVerdict: RunVerdict = {
      scenario: "s",
      pass: false,
      reasons: ["expected muggle-local-execute-test-generation to be called but it was not"],
      trace: { mcpCalls: [], askQuestions: [] },
    };
    transcript.appendVerdict(repVerdict);

    const lines = readFileSync(transcriptPath, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((line) => line.type)).toEqual(["thread.started", "item.completed", TRANSCRIPT_VERDICT_EVENT]);
    expect(lines[2].verdict).toEqual(repVerdict);
  });

  it("starts a rerun rep's file empty rather than appending to the last run's", () => {
    const transcriptPath = join(mkdtempSync(join(tmpdir(), "gate-transcript-")), "s.rep1.jsonl");
    openRepTranscript(transcriptPath).appendEvent({ type: "old" });
    openRepTranscript(transcriptPath).appendEvent({ type: "new" });
    expect(readFileSync(transcriptPath, "utf-8")).toBe('{"type":"new"}\n');
  });
});
