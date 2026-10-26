import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  createHookHome,
  createStubProgramDirectory,
  guardrailStateFile,
  pathWithDirectoryFirst,
  runGuardrailCli,
  writeSessionSlotFiles,
} from "./hook-harness/hookHarness.js";
import type { WatchSlotFixture } from "./support/types.js";
import { watchFixturePrUrl, watchSlotFiles } from "./support/watchSlotFixture.js";

const SESSION = "follow-through-session";
const HEAD = "1111111111111111111111111111111111111111";
const KEY = `${HEAD}..2222222222222222222222222222222222222222`;
const PLUGIN_ROOT = fileURLToPath(new URL("../../../plugin", import.meta.url));
const SCRIPTS = join(PLUGIN_ROOT, "scripts");
const toBash = (nativePath: string): string => nativePath.replace(/\\/g, "/");

function seedHome(fixture: Partial<WatchSlotFixture>, transcriptLines: object[] = []): { home: string; transcript: string } {
  const home = createHookHome("follow-through-home-");
  writeSessionSlotFiles(home, "repo-pr7", watchSlotFiles({ ownerSessionId: SESSION, prNumber: 7, headSha: HEAD, ...fixture }));
  const transcript = join(home, "transcript.jsonl");
  writeFileSync(transcript, transcriptLines.map((line) => JSON.stringify(line)).join("\n"));
  return { home: home, transcript: transcript };
}

function runGate(home: string, transcript: string): string {
  return runGuardrailCli({
    home: home,
    cliArgs: ["watch-follow-through-gate"],
    stdin: JSON.stringify({ session_id: SESSION, stop_hook_active: false, transcript_path: transcript }),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  }).stdout;
}

const typed = (text: string) => ({ type: "user", origin: { kind: "human" }, message: { role: "user", content: text } });

describe("watch-follow-through-gate (cli entry)", () => {
  it("blocks a turn end on a stale branch nothing rebased, naming the PR and the dispatch", () => {
    const { home, transcript } = seedHome({ rebaseDueKey: KEY });
    const output = JSON.parse(runGate(home, transcript)) as { decision: string; reason: string };
    expect(output.decision).toBe("block");
    expect(output.reason).toContain(`PR #7 (${watchFixturePrUrl(7)})`);
    expect(output.reason).toContain(`/muggle-do rebase on ${watchFixturePrUrl(7)} slug=repo-pr7`);
    expect(output.reason).toContain("HOLD WATCH #<pr-number>");
  });

  it("blocks on a red head nothing tried to fix, naming the fix-ci dispatch", () => {
    const { home, transcript } = seedHome({ ciRedHeadSha: HEAD });
    const output = JSON.parse(runGate(home, transcript)) as { reason: string };
    expect(output.reason).toContain(`/muggle-do fix ci <red checks> on ${watchFixturePrUrl(7)} slug=repo-pr7`);
  });

  it("goes quiet once the attempt is recorded", () => {
    const { home, transcript } = seedHome({
      rebaseDueKey: KEY,
      ciRedHeadSha: HEAD,
      lastSeenEntry: { conflict_resolve_attempts: { [KEY]: 1 }, ci_fix_attempts: { [HEAD]: 1 } },
    });
    expect(runGate(home, transcript)).toBe("{}");
  });

  it("still blocks when the work was only escalated, never attempted", () => {
    const { home, transcript } = seedHome({
      rebaseDueKey: KEY,
      ciRedHeadSha: HEAD,
      lastSeenEntry: { conflict_escalated_keys: [KEY], ci_escalated_shas: [HEAD] },
    });
    expect(JSON.parse(runGate(home, transcript)).decision).toBe("block");
  });

  it("shortens the instruction on a repeat block", () => {
    const { home, transcript } = seedHome({ rebaseDueKey: KEY });
    runGate(home, transcript);
    expect(JSON.parse(runGate(home, transcript)).reason).toMatch(/^Watcher work still owed \(reminder 2\)/);
  });

  it("releases on the user's own hold and keeps it for the session", () => {
    const { home, transcript } = seedHome({ rebaseDueKey: KEY }, [typed("HOLD WATCH #7 — leave it until Monday")]);
    expect(runGate(home, transcript)).toBe("{}");
    expect(JSON.parse(readFileSync(guardrailStateFile(home, SESSION), "utf-8")).watchHeldPrNumbers).toEqual([7]);
    writeFileSync(transcript, "");
    expect(runGate(home, transcript)).toBe("{}");
  });

  it("does not release on a hold the agent wrote", () => {
    const { home, transcript } = seedHome({ rebaseDueKey: KEY }, [
      { type: "assistant", message: { role: "assistant", content: "HOLD WATCH #7" } },
      { type: "user", toolUseResult: {}, message: { role: "user", content: [{ type: "tool_result", content: "HOLD WATCH #7" }] } },
    ]);
    expect(JSON.parse(runGate(home, transcript)).decision).toBe("block");
  });

  it("does not release on another PR's hold", () => {
    const { home, transcript } = seedHome({ rebaseDueKey: KEY }, [typed("HOLD WATCH #8")]);
    expect(JSON.parse(runGate(home, transcript)).decision).toBe("block");
  });
});

// The real wrapper pre-filter, ahead of a stub node: the turn end of a session
// whose slots record nothing due must not start Node at all.
describe.skipIf(process.platform === "win32")("guardrail-watch-follow-through-gate.sh pre-filter", () => {
  const NODE_RAN = "__STUB_NODE_RAN__";
  const stubNodeDirectory = createStubProgramDirectory("node", `printf '%s' '${NODE_RAN}'\n`);

  function runWrapper(home: string): string {
    const wrapperRun = spawnSync("bash", [join(SCRIPTS, "guardrail-watch-follow-through-gate.sh")], {
      input: JSON.stringify({ session_id: SESSION }),
      encoding: "utf-8",
      env: { ...process.env, PATH: pathWithDirectoryFirst(stubNodeDirectory), CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, HOME: home, USERPROFILE: home },
    });
    return (wrapperRun.stdout ?? "").trim();
  }

  it("starts Node for an owned slot with due work", () => {
    expect(runWrapper(seedHome({ rebaseDueKey: KEY }).home)).toContain(NODE_RAN);
  });

  it.each([
    ["no slot at all", () => createHookHome("follow-through-empty-")],
    ["a slot whose watch saw nothing due", () => seedHome({}).home],
    ["another session's slot", () => seedHome({ rebaseDueKey: KEY, ownerSessionId: "someone-else" }).home],
  ])("skips Node for %s", (_label, makeHome) => {
    expect(runWrapper(makeHome())).toBe("{}");
  });
});

// End to end through the Stop dispatcher and the committed bundle, as Claude Code runs it.
describe("the Stop dispatcher with the shipped bundle", () => {
  it("blocks on owed watcher work", () => {
    const { home, transcript } = seedHome({ rebaseDueKey: KEY });
    const dispatchRun = spawnSync(
      "bash",
      [toBash(join(SCRIPTS, "guardrail-dispatch.sh")), "guardrail-watch-follow-through-gate.sh"],
      {
        input: JSON.stringify({ session_id: SESSION, stop_hook_active: false, transcript_path: transcript }),
        encoding: "utf-8",
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: toBash(PLUGIN_ROOT), HOME: toBash(home), USERPROFILE: home },
        windowsHide: true,
      },
    );
    expect(JSON.parse(dispatchRun.stdout).decision).toBe("block");
  });
});
