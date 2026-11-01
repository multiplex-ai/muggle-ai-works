import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { nameFlagOf, pinClaudeJobName, readClaudeJob } from "../../watch/claude-jobs.js";
import { readCustomTitle } from "../../watch/claude-transcripts.js";
import { LIMIT_RESUME_PROMPT } from "../../watch/constants.js";
import { isPlaceholderSessionName, resolveSessionName } from "../../watch/session-names.js";
import { makeTempDir } from "./fixtures.js";

function writeJob(jobsDir: string, shortId: string, state: Record<string, unknown>): string {
  mkdirSync(join(jobsDir, shortId), { recursive: true });
  const statePath = join(jobsDir, shortId, "state.json");
  writeFileSync(statePath, JSON.stringify(state));
  return statePath;
}

describe("claude job records", () => {
  it("reads the respawn flags and opening prompt", () => {
    const jobsDir = makeTempDir("jobs");
    writeJob(jobsDir, "abcd1234", { respawnFlags: ["--agent", "claude", 7], intent: "Fix the build", tempo: "idle" });
    expect(readClaudeJob(jobsDir, "abcd1234")).toEqual({ respawnFlags: ["--agent", "claude"], intent: "Fix the build" });
    expect(readClaudeJob(jobsDir, "missing1")).toBeUndefined();
  });

  it("pins one --name, replacing an older one and keeping every other field", () => {
    const jobsDir = makeTempDir("jobs");
    const statePath = writeJob(jobsDir, "abcd1234", { respawnFlags: ["--name", "old", "--effort", "high"], tempo: "idle" });
    expect(pinClaudeJobName(jobsDir, "abcd1234", "deploy agent")).toBe(true);
    expect(JSON.parse(readFileSync(statePath, "utf-8"))).toEqual({ respawnFlags: ["--effort", "high", "--name", "deploy agent"], tempo: "idle" });
    expect(nameFlagOf(readClaudeJob(jobsDir, "abcd1234")?.respawnFlags ?? [])).toBe("deploy agent");
  });

  it("reports a job it cannot find as not pinned", () => {
    expect(pinClaudeJobName(makeTempDir("jobs"), "missing1", "deploy agent")).toBe(false);
  });
});

describe("readCustomTitle", () => {
  it("returns the latest /rename anywhere in the transcript", () => {
    const projectsDir = makeTempDir("projects");
    mkdirSync(join(projectsDir, "repo"));
    const entries = [
      { type: "custom-title", customTitle: "first name" },
      { type: "user", message: { content: "a custom-title mentioned in passing" } },
      { type: "custom-title", customTitle: "works guardrail" },
      { type: "agent-name", agentName: "something else" },
    ];
    writeFileSync(join(projectsDir, "repo", "sess.jsonl"), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    expect(readCustomTitle(projectsDir, "sess")).toBe("works guardrail");
    expect(readCustomTitle(projectsDir, "gone")).toBeUndefined();
  });
});

describe("session names", () => {
  it("treats a short id or a prompt the watch resumed on as a placeholder", () => {
    expect(isPlaceholderSessionName(undefined, "abcd1234")).toBe(true);
    expect(isPlaceholderSessionName("abcd1234", "abcd1234")).toBe(true);
    expect(isPlaceholderSessionName(LIMIT_RESUME_PROMPT, "abcd1234")).toBe(true);
    expect(isPlaceholderSessionName("/muggle:muggle-pr-followup red-pr 1 --wake=event", "abcd1234")).toBe(true);
    expect(isPlaceholderSessionName("deploy agent", "abcd1234")).toBe(false);
  });

  it("keeps the user's /rename over everything else", () => {
    expect(
      resolveSessionName({
        shortId: "7e937a88",
        customTitle: "convert starter to pro campaign",
        job: { respawnFlags: ["--name", "started as"], intent: "Draft the campaign" },
        registeredName: LIMIT_RESUME_PROMPT,
      }),
    ).toBe("convert starter to pro campaign");
  });

  it("falls back from --name to the shown name to the opening prompt, skipping placeholders", () => {
    const job = { respawnFlags: ["--agent", "claude"], intent: "Support login via google\nin teaching studio" };
    expect(resolveSessionName({ shortId: "cf9cfca2", job: { ...job, respawnFlags: ["--name", "deploy agent"] }, registeredName: "x" })).toBe("deploy agent");
    expect(resolveSessionName({ shortId: "cf9cfca2", job: job, registeredName: "google login" })).toBe("google login");
    expect(resolveSessionName({ shortId: "cf9cfca2", job: job, registeredName: "cf9cfca2" })).toBe("Support login via google in teaching studio");
  });

  it("cuts an opening-prompt name where Claude does", () => {
    const intent = "x".repeat(250);
    expect(resolveSessionName({ shortId: "abcd1234", job: { respawnFlags: [], intent: intent } })).toBe("x".repeat(200));
  });

  it("gives no name when nothing real is on record", () => {
    expect(resolveSessionName({ shortId: "abcd1234", registeredName: "abcd1234" })).toBeUndefined();
    expect(resolveSessionName({ shortId: "abcd1234", job: { respawnFlags: [], intent: "/muggle:muggle-do build it" } })).toBeUndefined();
  });
});
