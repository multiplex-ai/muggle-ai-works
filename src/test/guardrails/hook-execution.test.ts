import { describe, it, expect, beforeEach, vi } from "vitest";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, dirname, join } from "path";
import { GUARDRAIL_CLI_ENTRY } from "./hook-harness/constants.js";
import { E2eSkipCode } from "../../e2e-skip/types.js";
import {
  createHookHome,
  createStubProgramDirectory,
  createWalkthroughProbeGhStub,
  guardrailStateFile,
  pathWithDirectoryFirst,
  runGuardrailCli,
  walkthroughProbeAnswerEnvironment,
  writeGuardrailState,
  writeSessionSlotFiles,
} from "./hook-harness/hookHarness.js";

// End-to-end hook contract. The per-function guardrail logic is unit-tested
// elsewhere; this file exercises the *entry* the way Claude Code runs it —
// stdin = event JSON, argv[2] = subcommand, stdout = the hook's JSON response —
// by running the real source entry (src/guardrails/cli.ts) as a subprocess.
// It pins stdin parsing, subcommand dispatch, cross-hook state I/O, and stdout
// emission: the observable contract the "Lazy core" footprint refactor must
// preserve when it drops the bash wrappers and collapses the per-event fan-out.
const SCRIPTS = fileURLToPath(new URL("../../../plugin/scripts", import.meta.url));
const HOOKS = fileURLToPath(new URL("../../../plugin/hooks/hooks.json", import.meta.url));

describe("guardrail hook execution (cli entry)", () => {
  let home: string;
  beforeEach(() => {
    home = createHookHome("gr-hook-");
  });

  function runHook(sub: string, stdin: string): { status: number | null; out: string } {
    const cliRun = runGuardrailCli({ home: home, cliArgs: [sub], stdin: stdin });
    return { status: cliRun.status, out: cliRun.stdout };
  }
  const event = (o: unknown): string => JSON.stringify(o);

  it("pr-opened: emits a PostToolUse watcher nudge for a fresh gh pr create", () => {
    const { status, out } = runHook(
      "pr-opened",
      event({
        session_id: "s1",
        tool_name: "Bash",
        tool_input: { command: "gh pr create --title x --body y" },
        tool_response: { stdout: "https://github.com/multiplex-ai/muggle-ai-ui/pull/342\n" },
      }),
    );
    expect(status).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "https://github.com/multiplex-ai/muggle-ai-ui/pull/342",
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain("autoWatchPR");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("visual-walkthrough comment is being reserved");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("opens already settled as skipped (NO_APP_LOGIC_CHANGE)");
  });

  it("pr-opened: dedupes the same PR within a session (second fire is a no-op)", () => {
    const ev = event({
      session_id: "dedupe",
      tool_name: "Bash",
      tool_input: { command: "gh pr create" },
      tool_response: { stdout: "https://github.com/o/r/pull/9\n" },
    });
    expect(runHook("pr-opened", ev).out).not.toBe("{}");
    // state persisted across separate process invocations under the shared HOME
    expect(runHook("pr-opened", ev).out).toBe("{}");
  });

  it("pr-opened: ignores a non-PR Bash command", () => {
    const { out } = runHook(
      "pr-opened",
      event({
        session_id: "s2",
        tool_name: "Bash",
        tool_input: { command: "git status" },
        tool_response: { stdout: "" },
      }),
    );
    expect(out).toBe("{}");
  });

  it("record-tests -> e2e-gate: a unit-test pass arms the Stop gate (cross-hook state flow)", () => {
    const session = "chain";
    const rec = runHook(
      "record-tests",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: { stdout: "Tests: 18 passed", stderr: "" },
      }),
    );
    expect(rec.out).toBe("{}"); // record-tests only persists, never emits

    const gate = runHook("e2e-gate", event({ session_id: session }));
    const parsed = JSON.parse(gate.out);
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toContain("E2E");
  });

  it("record-delegation -> e2e-gate: a background acceptance-tester holds the gate off; a foreground one does not", () => {
    const unitGreen = (session: string): void => {
      runHook(
        "record-tests",
        event({
          session_id: session,
          tool_name: "Bash",
          tool_input: { command: "pnpm test" },
          tool_response: { stdout: "Tests: 18 passed", stderr: "" },
        }),
      );
    };
    const dispatchAcceptanceTester = (session: string, response: string): string =>
      runHook(
        "record-delegation",
        event({
          session_id: session,
          tool_name: "Agent",
          tool_input: { subagent_type: "muggle:acceptance-tester", prompt: "Run E2E for fix-login" },
          tool_response: { output: response },
        }),
      ).out;

    unitGreen("delegated");
    expect(dispatchAcceptanceTester("delegated", "Async agent launched.")).toBe("{}");
    expect(runHook("e2e-gate", event({ session_id: "delegated" })).out).toBe("{}");

    unitGreen("foreground");
    dispatchAcceptanceTester("foreground", "## Test Summary\n- **Verdict:** PASS");
    expect(JSON.parse(runHook("e2e-gate", event({ session_id: "foreground" })).out).decision).toBe("block");
  });

  it("e2e-gate: stays silent when no unit-test pass was recorded", () => {
    expect(runHook("e2e-gate", event({ session_id: "fresh" })).out).toBe("{}");
  });

  it("pr-opened -> watch-gate: an opened PR that no slot tracks blocks the Stop", () => {
    const session = "watch-chain";
    runHook(
      "pr-opened",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "gh pr create" },
        tool_response: { stdout: "https://github.com/o/r/pull/77\n" },
      }),
    );
    const gate = JSON.parse(runHook("watch-gate", event({ session_id: session })).out);
    expect(gate.decision).toBe("block");
    expect(gate.reason).toContain("no live muggle-pr-followup watch");
    expect(gate.reason).toContain("arm-watcher.md");
    expect(gate.reason).toContain("https://github.com/o/r/pull/77");
    expect(gate.reason).toContain("MUGGLE_WATCH_SKIP");
  });

  const seedWatchSlot = (slug: string, url: string, files: Record<string, string> = {}): void => {
    const slot = join(home, ".muggle-ai", "muggle-do", "sessions", slug);
    mkdirSync(slot, { recursive: true });
    writeFileSync(join(slot, "prs.json"), JSON.stringify([{ url: url, state: "open" }]));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(slot, name), body);
  };

  const openPr = (session: string, url: string): void => {
    runHook(
      "pr-opened",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "gh pr create" },
        tool_response: { stdout: `${url}\n` },
      }),
    );
  };

  it("watch-gate: silent once a running watch loop's fresh heartbeat covers the opened PR", () => {
    const session = "watch-live";
    const url = "https://github.com/o/r/pull/78";
    openPr(session, url);
    expect(JSON.parse(runHook("watch-gate", event({ session_id: session })).out).decision).toBe("block");

    seedWatchSlot("r-pr78", url, { "watch-heartbeat": "" });
    expect(runHook("watch-gate", event({ session_id: session })).out).toBe("{}");
  });

  // A seeded slot used to satisfy the gate on its own, and a slot nothing polls
  // is a PR nobody watches — the gate now asks for the loop, not the files.
  it("watch-gate: a slot with prs.json but no heartbeat still blocks", () => {
    const session = "watch-seeded";
    const url = "https://github.com/o/r/pull/80";
    openPr(session, url);
    seedWatchSlot("r-pr80", url);
    const gate = JSON.parse(runHook("watch-gate", event({ session_id: session })).out);
    expect(gate.decision).toBe("block");
    expect(gate.reason).toContain("A seeded slot does not count");
  });

  // Post-merge cleanup deletes the slot, so a merge the session saw must clear
  // the PR without a provider round trip.
  it("pr-terminal -> watch-gate: a merged PR whose slot cleanup removed does not block", () => {
    const session = "watch-merged";
    openPr(session, "https://github.com/o/r/pull/81");
    runHook(
      "pr-terminal",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "gh pr merge 81 --squash" },
        tool_response: { stdout: "", stderr: "✓ Squashed and merged pull request o/r#81 (title)\n" },
      }),
    );
    expect(runHook("watch-gate", event({ session_id: session })).out).toBe("{}");
  });

  it("record-tests -> watch-gate: a MUGGLE_WATCH_SKIP marker releases the gate", () => {
    const session = "watch-skip";
    runHook(
      "pr-opened",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "gh pr create" },
        tool_response: { stdout: "https://github.com/o/r/pull/79\n" },
      }),
    );
    expect(JSON.parse(runHook("watch-gate", event({ session_id: session })).out).decision).toBe("block");
    runHook(
      "record-tests",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: 'echo "MUGGLE_WATCH_SKIP: manual PR, autoWatchPR=never"' },
        tool_response: { stdout: "MUGGLE_WATCH_SKIP: manual PR, autoWatchPR=never" },
      }),
    );
    expect(runHook("watch-gate", event({ session_id: session })).out).toBe("{}");
  });

  it("watch-gate: silent when no PR was opened this session", () => {
    expect(runHook("watch-gate", event({ session_id: "no-pr" })).out).toBe("{}");
  });

  // These settle before the gate reaches its provider lookups, so they never
  // shell out to gh — the lookup paths are covered by walkthroughOwed.test.ts
  // with an injected lookup, and end-to-end by the stubbed-gh block below.
  it("walkthrough-gate: silent when no acceptance run happened this session", () => {
    expect(runHook("walkthrough-gate", event({ session_id: "no-e2e" })).out).toBe("{}");
  });

  it("skill-stages -> record-tests -> walkthrough-gate: a sentinel-carrying post settles the gate", () => {
    const session = "walkthrough-posted";
    runHook(
      "skill-stages",
      event({
        session_id: session,
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-skill-emit",
        tool_input: { skillName: "muggle-test" },
      }),
    );
    runHook(
      "record-tests",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "gh pr comment 7 --body '<!-- muggle-pr-section:v1 --> results'" },
        tool_response: { stdout: "https://github.com/o/r/pull/7#issuecomment-1" },
      }),
    );
    expect(runHook("walkthrough-gate", event({ session_id: session })).out).toBe("{}");
  });

  it("record-tests -> walkthrough-gate: a post settles the PR it reached, before the provider shows it, and only that PR", () => {
    const prA = "https://github.com/o/r/pull/7";
    const prB = "https://github.com/o/other/pull/8";
    const seedSession = (session: string, prsHandled: string[]): void => {
      writeGuardrailState(home, { sessionId: session, prsHandled: prsHandled, e2eRun: true });
      // A scan that read every PR before the post reached it, as a provider can.
      writeFileSync(
        join(home, ".muggle-ai", "guardrails", `${session}.walkthrough-scan.json`),
        JSON.stringify({ prsHandled: prsHandled, owed: prsHandled, verified: [], startedAt: 1 }),
      );
    };
    const postTo = (session: string, prUrl: string): void => {
      runHook(
        "record-tests",
        event({
          session_id: session,
          tool_name: "Bash",
          tool_input: { command: "gh pr comment --body '<!-- muggle-pr-section:v1 --> results'" },
          tool_response: { stdout: `${prUrl}#issuecomment-1` },
        }),
      );
    };

    seedSession("posted-one", [prA]);
    postTo("posted-one", prA);
    expect(runHook("walkthrough-gate", event({ session_id: "posted-one" })).out).toBe("{}");

    seedSession("posted-first-of-two", [prA, prB]);
    postTo("posted-first-of-two", prA);
    const blocked = JSON.parse(runHook("walkthrough-gate", event({ session_id: "posted-first-of-two" })).out);
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain(prB);
    expect(blocked.reason).not.toContain(prA);
  });

  it("skill-stages -> record-tests -> walkthrough-gate: a MUGGLE_WALKTHROUGH_SKIP marker settles the gate", () => {
    const session = "walkthrough-skip";
    runHook(
      "skill-stages",
      event({
        session_id: session,
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-skill-emit",
        tool_input: { skillName: "muggle-test" },
      }),
    );
    runHook(
      "record-tests",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: 'echo "MUGGLE_WALKTHROUGH_SKIP: results belong to another PR"' },
        tool_response: { stdout: "MUGGLE_WALKTHROUGH_SKIP: results belong to another PR" },
      }),
    );
    expect(runHook("walkthrough-gate", event({ session_id: session })).out).toBe("{}");
  });

  // Close+reopen is routine: it re-fires a lost workflow trigger to start checks
  // and re-syncs a head left at the base branch after a force-push through it.
  // The change is open again, so the terminal gate must let the turn end.
  it("pr-terminal -> reopen -> terminal-gate: a transient close does not hold the Stop", () => {
    const session = "reopen-chain";
    runHook(
      "pr-terminal",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "gh pr close 369" },
        tool_response: { stderr: "✓ Closed pull request multiplex-ai/muggle-ai-works#369 (gate fix)\n" },
      }),
    );
    expect(JSON.parse(runHook("terminal-gate", event({ session_id: session })).out).decision).toBe("block");

    runHook(
      "pr-terminal",
      event({
        session_id: session,
        tool_input: { command: "gh pr reopen 369" },
        tool_name: "Bash",
        tool_response: { stderr: "✓ Reopened pull request multiplex-ai/muggle-ai-works#369 (gate fix)\n" },
      }),
    );
    expect(runHook("terminal-gate", event({ session_id: session })).out).toBe("{}");
  });

  it("reopen then a genuine merge re-arms the handoff", () => {
    const session = "reopen-then-merge";
    const bashEvent = (stderr: string): string =>
      event({ session_id: session, tool_name: "Bash", tool_response: { stderr: stderr } });
    runHook("pr-terminal", bashEvent("✓ Closed pull request o/r#77 (transient)\n"));
    runHook("pr-terminal", bashEvent("✓ Reopened pull request o/r#77 (transient)\n"));
    expect(runHook("terminal-gate", event({ session_id: session })).out).toBe("{}");

    runHook("pr-terminal", bashEvent("✓ Squashed and merged pull request o/r#77 (shipped)\n"));
    const blocked = JSON.parse(runHook("terminal-gate", event({ session_id: session })).out);
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain("#77");
  });

  it("pr-terminal -> terminal-gate: a merged PR holds the Stop until the AskUserQuestion offer runs", () => {
    const session = "terminal-chain";
    const detect = runHook(
      "pr-terminal",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "gh pr merge 341 --squash" },
        tool_response: { stdout: "", stderr: "✓ Squashed and merged pull request #341 (feat: thing)\n" },
      }),
    );
    const nudge = JSON.parse(detect.out);
    expect(nudge.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(nudge.hookSpecificOutput.additionalContext).toContain("PR #341");
    expect(nudge.hookSpecificOutput.additionalContext).toContain("AskUserQuestion");

    const blocked = JSON.parse(runHook("terminal-gate", event({ session_id: session })).out);
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain("#341");

    expect(runHook("offer-ran", event({ session_id: session, tool_name: "AskUserQuestion" })).out).toBe("{}");
    expect(runHook("terminal-gate", event({ session_id: session })).out).toBe("{}");
  });

  // A pending AskUserQuestion holds the turn, so a session still watching another
  // PR offers in prose: the question its closing message asks clears the gate.
  describe("while the session still watches an open PR", () => {
    const mergeEvent = (session: string): string =>
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "gh pr merge 556 --squash" },
        tool_response: { stderr: "✓ Squashed and merged pull request #556 (fix: watcher)\n" },
      });
    const seedOwnedOpenSlot = (session: string): void => {
      writeSessionSlotFiles(home, `works-pr533-${session}`, {
        "owner.json": JSON.stringify({ session_id: session, claimed_at: "2026-10-26T00:00:00Z" }),
        "prs.json": JSON.stringify([{ url: "https://github.com/o/r/pull/533", state: "OPEN" }]),
      });
    };

    it("pr-terminal -> terminal-gate: directs a text offer and clears on the closing question", () => {
      const session = "watching-merge";
      seedOwnedOpenSlot(session);
      const nudge = JSON.parse(runHook("pr-terminal", mergeEvent(session)).out);
      expect(nudge.hookSpecificOutput.additionalContext).toContain("as text in your closing message");

      const blocked = JSON.parse(
        runHook("terminal-gate", event({ session_id: session, last_assistant_message: "#556 merged and cleaned up." })).out,
      );
      expect(blocked.decision).toBe("block");
      expect(blocked.reason).toContain("closing message");

      expect(
        runHook(
          "terminal-gate",
          event({ session_id: session, last_assistant_message: "1. Re-arm #533\n2. Done — stop here\nWhich one?" }),
        ).out,
      ).toBe("{}");
    });

    it("terminal-gate: reads the closing question from the Claude Code transcript", () => {
      const session = "watching-transcript";
      seedOwnedOpenSlot(session);
      runHook("pr-terminal", mergeEvent(session));
      const transcriptPath = join(home, "transcript.jsonl");
      writeFileSync(
        transcriptPath,
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Next: 1. Done — which?" }] } }) +
          "\n",
      );
      expect(runHook("terminal-gate", event({ session_id: session, transcript_path: transcriptPath })).out).toBe("{}");
    });

    it("terminal-gate: a slot owned by another session keeps the AskUserQuestion rule", () => {
      const session = "foreign-watch";
      seedOwnedOpenSlot("someone-else");
      runHook("pr-terminal", mergeEvent(session));
      const blocked = JSON.parse(
        runHook("terminal-gate", event({ session_id: session, last_assistant_message: "Merged. What next?" })).out,
      );
      expect(blocked.decision).toBe("block");
      expect(blocked.reason).toContain("AskUserQuestion");
    });
  });

  it("terminal-gate: full instruction once, one-line reminders after, hard release after 3 blocks", () => {
    const session = "terminal-cap";
    runHook(
      "pr-terminal",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_response: { stderr: "✓ Closed pull request o/r#12 (stale)\n" },
      }),
    );
    const first = JSON.parse(runHook("terminal-gate", event({ session_id: session })).out);
    expect(first.decision).toBe("block");
    expect(first.reason).toContain("Do not end the turn yet");
    const second = JSON.parse(runHook("terminal-gate", event({ session_id: session })).out);
    expect(second.reason).toContain("2/3");
    expect(second.reason.length).toBeLessThan(first.reason.length);
    expect(JSON.parse(runHook("terminal-gate", event({ session_id: session })).out).decision).toBe("block");
    expect(runHook("terminal-gate", event({ session_id: session })).out).toBe("{}");
  });

  it("pr-terminal: ignores PR state metadata in a JSON fetch", () => {
    const { out } = runHook(
      "pr-terminal",
      event({
        session_id: "terminal-json",
        tool_name: "Bash",
        tool_input: { command: "gh pr view 9 --json state" },
        tool_response: { stdout: '{"state":"MERGED"}' },
      }),
    );
    expect(out).toBe("{}");
  });

  it("offer-ran: an AskUserQuestion with nothing pending is a no-op", () => {
    expect(runHook("offer-ran", event({ session_id: "no-pending", tool_name: "AskUserQuestion" })).out).toBe("{}");
    expect(runHook("terminal-gate", event({ session_id: "no-pending" })).out).toBe("{}");
  });

  it("record-tests -> e2e-gate: a verified skip code releases an armed gate", () => {
    const session = "skip-chain";
    runHook(
      "record-tests",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: { stdout: "Tests: 18 passed", stderr: "" },
      }),
    );
    runHook(
      "record-tests",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: 'echo "MUGGLE_E2E_SKIP: NO_PR: nothing was opened this session"' },
        tool_response: { stdout: "MUGGLE_E2E_SKIP: NO_PR: nothing was opened this session" },
      }),
    );
    expect(runHook("e2e-gate", event({ session_id: session })).out).toBe("{}");
  });

  // The whole point of the enum: an articulate excuse must not buy what a
  // verified fact buys. This is the muggle-ai-ui#613 shape end to end.
  it("record-tests -> e2e-gate: an unverifiable excuse leaves the gate armed", () => {
    const session = "excuse-chain";
    runHook(
      "record-tests",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: { stdout: "Tests: 18 passed", stderr: "" },
      }),
    );
    const rejected = runHook(
      "record-tests",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: {
          command: 'echo "MUGGLE_E2E_SKIP: verified instead with puppeteer against the dev server"',
        },
        tool_response: { stdout: "" },
      }),
    );
    expect(rejected.out).toContain("not a skip code");
    expect(runHook("e2e-gate", event({ session_id: session })).out).not.toBe("{}");
  });

  it("record-tests -> skill-stages -> e2e-gate: a muggle-test skill emit (clean SKIP path) releases an armed gate", () => {
    const session = "skill-emit-chain";
    runHook(
      "record-tests",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: { stdout: "Tests: 18 passed", stderr: "" },
      }),
    );
    expect(JSON.parse(runHook("e2e-gate", event({ session_id: session })).out).decision).toBe("block");
    runHook(
      "skill-stages",
      event({
        session_id: session,
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-skill-emit",
        tool_input: { skillName: "muggle-test" },
      }),
    );
    expect(runHook("e2e-gate", event({ session_id: session })).out).toBe("{}");
  });

  it("e2e-gate: full instruction on the first block, one-line reminder on repeats", () => {
    const session = "terse-repeats";
    runHook(
      "record-tests",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: { stdout: "Tests: 18 passed", stderr: "" },
      }),
    );
    const first = JSON.parse(runHook("e2e-gate", event({ session_id: session })).out);
    expect(first.decision).toBe("block");
    expect(first.reason).toContain("Do not end the turn yet");
    expect(first.reason).toContain("MUGGLE_E2E_SKIP");

    const second = JSON.parse(runHook("e2e-gate", event({ session_id: session })).out);
    expect(second.decision).toBe("block");
    expect(second.reason).toContain("2/3");
    expect(second.reason).toContain("MUGGLE_E2E_SKIP");
    expect(second.reason.length).toBeLessThan(first.reason.length);
  });

  const e2eSidecar = (session: string, suffix: string): string =>
    guardrailStateFile(home, session).replace(/\.json$/, suffix);
  const prCreateEvent = (session: string): string =>
    event({
      session_id: session,
      tool_name: "PowerShell",
      tool_input: { command: "gh pr create --repo o/r --base master --head b --title t --body-file body.md" },
      tool_response: { stdout: "https://github.com/o/r/pull/723\n" },
    });

  it("pr-opened -> e2e-gate: renders the owed-E2E block for the shell, whose blocks spend the same budget", () => {
    const session = "rendered-verdict";
    runHook("pr-opened", prCreateEvent(session));

    const [maxBlocksLine, hookOutput] = readFileSync(e2eSidecar(session, ".e2e-stop-verdict"), "utf-8").split("\n");
    expect(maxBlocksLine).toBe("3");
    expect(JSON.parse(hookOutput).decision).toBe("block");

    writeFileSync(e2eSidecar(session, ".e2e-shell-blocks"), "x");
    expect(JSON.parse(runHook("e2e-gate", event({ session_id: session })).out).reason).toContain("2/3");

    writeFileSync(e2eSidecar(session, ".e2e-shell-blocks"), "xx");
    expect(runHook("e2e-gate", event({ session_id: session })).out).toBe("{}");
  });

  it("e2e-gate: under autoE2ETest=always the reason names the preferences and forbids handing the decision back", () => {
    const session = "always-prefs";
    mkdirSync(join(home, ".muggle-ai"), { recursive: true });
    writeFileSync(
      join(home, ".muggle-ai", "preferences.json"),
      JSON.stringify({ preferences: { autoE2ETest: "always", postPRVisualWalkthrough: "always" } }),
    );
    runHook("pr-opened", prCreateEvent(session));

    const reason = JSON.parse(runHook("e2e-gate", event({ session_id: session })).out).reason as string;
    expect(reason).toContain("autoE2ETest=always");
    expect(reason).toContain("postPRVisualWalkthrough=always");
    expect(reason).toContain("do not ask them whether to test");
    expect(reason).toContain("muggle-pr-visual-walkthrough");
    expect(reason).not.toContain(E2eSkipCode.NotApplicable);
  });

  it("skill-stages: a registered E2E run rewinds the shell's share of the block budget", () => {
    const session = "shell-blocks-reset";
    runHook("pr-opened", prCreateEvent(session));
    writeFileSync(e2eSidecar(session, ".e2e-shell-blocks"), "xx");
    runHook(
      "skill-stages",
      event({
        session_id: session,
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-skill-emit",
        tool_input: { skillName: "muggle-test" },
      }),
    );
    expect(existsSync(e2eSidecar(session, ".e2e-shell-blocks"))).toBe(false);
  });

  it("build-router: nudges a build ask toward muggle-do, once per session", () => {
    const ev = event({ session_id: "br", prompt: "implement a dark-mode toggle" });
    const first = JSON.parse(runHook("build-router", ev).out);
    expect(first.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(first.hookSpecificOutput.additionalContext).toContain("muggle-do");
    expect(runHook("build-router", ev).out).toBe("{}"); // deduped within the session
  });

  it("build-router: arms the follow-through on a /mdo invocation without advising, so a PR-less turn end blocks", () => {
    const session = "mdo";
    expect(runHook("build-router", event({ session_id: session, prompt: "/mdo paginate the export page" })).out).toBe("{}");
    expect(JSON.parse(readFileSync(guardrailStateFile(home, session), "utf-8")).buildIntentRouted).toBe(true);
    expect(JSON.parse(runHook("build-followthrough-gate", event({ session_id: session })).out).decision).toBe("block");
  });

  it("build-router: leaves a watcher-dispatched muggle-do directive unarmed", () => {
    const session = "directive";
    const prompt = "/muggle-do rebase on https://github.com/o/r/pull/7 slug=fix-parser";
    expect(runHook("build-router", event({ session_id: session, prompt: prompt })).out).toBe("{}");
    expect(runHook("build-followthrough-gate", event({ session_id: session })).out).toBe("{}");
  });

  it("build-router: ignores a non-build prompt", () => {
    const { out } = runHook(
      "build-router",
      event({ session_id: "q", prompt: "why does the failed job have no screenshots?" }),
    );
    expect(out).toBe("{}");
  });

  // Never-block guarantee at the entry: a hook must never crash the turn.
  const PR_URL = "https://github.com/o/r/pull/7";

  // The gate reads obligations from the per-PR ledger in the muggle-do slot, so
  // a flow test has to stand up both: the slot the PR maps to, and the session
  // state naming that PR as handled.
  function seedSlot(sid: string): string {
    writeGuardrailState(home, { sessionId: sid, prsHandled: [PR_URL] });
    return writeSessionSlotFiles(home, "slug", { "prs.json": JSON.stringify([{ url: PR_URL }]) });
  }

  const threadFetchEvent = (sid: string, comments: Array<{ databaseId: number; body: string; createdAt: string }>) =>
    event({
      session_id: sid,
      tool_name: "Bash",
      tool_input: { command: "gh api graphql -f query='{ reviewThreads { nodes { id } } }'" },
      tool_response: {
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [{ id: "T1", isResolved: false, comments: { nodes: comments } }],
                },
              },
            },
          },
        }),
      },
    });

  const replyEvent = (sid: string, commentId: string, response: unknown) =>
    event({
      session_id: sid,
      tool_name: "Bash",
      tool_input: { command: `gh api --method POST repos/o/r/pulls/7/comments/${commentId}/replies -f body=x` },
      tool_response: { stdout: JSON.stringify(response) },
    });

  const humanComment = { databaseId: 11, body: "this leaks a handle", createdAt: "2026-08-01T00:00:00Z" };
  const createdReply = { id: 999, body: "<!-- muggle-do:bot --> Addressed in c88acd5: fixed." };

  it("record-comment-replies -> comment-reply-gate: a claimed thread blocks until the reply is confirmed", () => {
    const sid = "s-reply";
    seedSlot(sid);
    runHook("record-comment-replies", threadFetchEvent(sid, [humanComment]));

    const blocked = JSON.parse(runHook("comment-reply-gate", event({ session_id: sid })).out);
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain("11");

    runHook("record-comment-replies", replyEvent(sid, "11", createdReply));
    expect(runHook("comment-reply-gate", event({ session_id: sid })).out).toBe("{}");
  });

  // per-comment-replies.md expects individual replies to fail and logs them, so
  // a rejected reply must leave the obligation open rather than closing it.
  it("record-comment-replies: a rejected reply does not clear the obligation", () => {
    const sid = "s-reply-rejected";
    seedSlot(sid);
    runHook("record-comment-replies", threadFetchEvent(sid, [humanComment]));
    runHook("record-comment-replies", replyEvent(sid, "11", { message: "Validation Failed" }));
    const blocked = JSON.parse(runHook("comment-reply-gate", event({ session_id: sid })).out);
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain("11");
  });

  it("record-comment-replies -> comment-reply-gate: a MUGGLE_REPLY_SKIP marker settles the gate", () => {
    const sid = "s-reply-skip";
    seedSlot(sid);
    runHook("record-comment-replies", threadFetchEvent(sid, [humanComment]));
    runHook(
      "record-comment-replies",
      event({
        session_id: sid,
        tool_name: "Bash",
        tool_input: { command: 'echo "MUGGLE_REPLY_SKIP: 11 escalated to the user"' },
      }),
    );
    expect(runHook("comment-reply-gate", event({ session_id: sid })).out).toBe("{}");
  });

  it("comment-reply-gate: stays silent when no slot tracks the PR", () => {
    const sid = "s-reply-noslot";
    expect(runHook("comment-reply-gate", event({ session_id: sid })).out).toBe("{}");
  });

  // The gate runs on every turn end, so its write budget is the thing to pin: it
  // writes only to bump the block count, which the ceiling caps, and a released
  // gate must go inert rather than rewrite state for the rest of the session.
  it("comment-reply-gate: writes only while blocking, at most 3 times, then goes inert", () => {
    const sid = "s-reply-cap";
    seedSlot(sid);
    runHook("record-comment-replies", threadFetchEvent(sid, [humanComment]));

    const stateFile = join(home, ".muggle-ai", "guardrails", `${sid}.json`);
    for (const expectedBlock of [1, 2, 3]) {
      expect(JSON.parse(runHook("comment-reply-gate", event({ session_id: sid })).out).decision).toBe(
        "block",
      );
      expect(JSON.parse(readFileSync(stateFile, "utf-8")).commentReplyBlockCount).toBe(expectedBlock);
    }

    // Releasing writes once, to stamp the release the wrapper pre-filters on.
    expect(runHook("comment-reply-gate", event({ session_id: sid })).out).toBe("{}");
    const settled = readFileSync(stateFile, "utf-8");
    expect(JSON.parse(settled).commentReplyReleased).toBe(true);
    expect(JSON.parse(settled).commentReplyBlockCount).toBe(3);

    // Every turn end after that is inert.
    expect(runHook("comment-reply-gate", event({ session_id: sid })).out).toBe("{}");
    expect(runHook("comment-reply-gate", event({ session_id: sid })).out).toBe("{}");
    expect(readFileSync(stateFile, "utf-8")).toBe(settled);
  });

  it("degrades to {} on malformed stdin", () => {
    const { status, out } = runHook("pr-opened", "this is not json");
    expect(status).toBe(0);
    expect(out).toBe("{}");
  });

  it("degrades to {} on an unknown subcommand", () => {
    const { status, out } = runHook("does-not-exist", event({ session_id: "s" }));
    expect(status).toBe(0);
    expect(out).toBe("{}");
  });

  it("degrades to {} on empty stdin", () => {
    const { status, out } = runHook("e2e-gate", "");
    expect(status).toBe(0);
    expect(out).toBe("{}");
  });
});

// Codex fires the same subcommands through plugin/hooks/codex-hooks.json, which
// stamps MUGGLE_HOOK_HOST=codex. Its payloads differ from Claude Code's where it
// matters: a shell result is the bare output string, the Stop payload carries the
// closing message, and there is no AskUserQuestion — only request_user_input in
// some modes — so the post-merge offer is the question the turn closes on.
describe("guardrail hook execution under Codex (cli entry)", () => {
  let home: string;
  beforeEach(() => {
    home = createHookHome("gr-codex-hook-");
  });

  function runHook(sub: string, payload: unknown, hookHost: string = "codex"): string {
    return runGuardrailCli({
      home: home,
      cliArgs: [sub],
      stdin: JSON.stringify(payload),
      env: { ...process.env, MUGGLE_HOOK_HOST: hookHost },
    }).stdout;
  }

  it("pr-opened: reads the PR url out of Codex's string output and names the skill as Codex spells it", () => {
    const parsed = JSON.parse(
      runHook("pr-opened", {
        session_id: "cx-open",
        turn_id: "t1",
        tool_name: "Bash",
        tool_input: { command: "gh pr create --title x --body y" },
        tool_response: "https://github.com/o/r/pull/77\n",
      }),
    );
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("https://github.com/o/r/pull/77");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("$muggle:muggle-pr-followup");
  });

  it("record-tests -> e2e-gate: a passing suite in Codex's string output arms the gate", () => {
    runHook("record-tests", {
      session_id: "cx-unit",
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      tool_response: " Test Files  3 passed (3)\n      Tests  41 passed (41)\n",
    });
    const gate = JSON.parse(runHook("e2e-gate", { session_id: "cx-unit" }));
    expect(gate.decision).toBe("block");
    expect(gate.reason).toContain("$muggle:muggle-test");
    expect(gate.reason).not.toContain("/muggle:muggle-test");
  });

  it("pr-terminal -> terminal-gate: the closing question is the offer that clears the gate", () => {
    const nudge = JSON.parse(
      runHook("pr-terminal", {
        session_id: "cx-merge",
        tool_name: "Bash",
        tool_input: { command: "gh pr merge 77 --squash" },
        tool_response: "✓ Squashed and merged pull request o/r#77 (feat: x)\n",
      }),
    );
    expect(nudge.hookSpecificOutput.additionalContext).toContain("closing message");
    expect(nudge.hookSpecificOutput.additionalContext).not.toContain("AskUserQuestion");

    const blocked = JSON.parse(
      runHook("terminal-gate", { session_id: "cx-merge", last_assistant_message: "Merged and cleaned up." }),
    );
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain("#77");

    expect(
      runHook("terminal-gate", {
        session_id: "cx-merge",
        last_assistant_message: "PR #77 is merged. Next: 1) release, 2) the queued logout work — which one?",
      }),
    ).toBe("{}");
  });

  it("offer-ran: Codex's request_user_input clears a pending handoff", () => {
    runHook("pr-terminal", {
      session_id: "cx-ask",
      tool_name: "Bash",
      tool_input: { command: "gh pr close 12" },
      tool_response: "✓ Closed pull request o/r#12 (stale)\n",
    });
    expect(runHook("offer-ran", { session_id: "cx-ask", tool_name: "request_user_input" })).toBe("{}");
    expect(runHook("terminal-gate", { session_id: "cx-ask", last_assistant_message: "Done." })).toBe("{}");
  });

  // Claude Code has AskUserQuestion, so with no open PR still watched a question in prose is not the offer there.
  it("terminal-gate: a closing question does not stand in for the offer under Claude Code", () => {
    runHook(
      "pr-terminal",
      {
        session_id: "cc-merge",
        tool_name: "Bash",
        tool_input: { command: "gh pr merge 5" },
        tool_response: { stderr: "✓ Merged pull request o/r#5 (x)\n" },
      },
      "",
    );
    const blocked = JSON.parse(
      runHook("terminal-gate", { session_id: "cc-merge", last_assistant_message: "Merged. What next?" }, ""),
    );
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain("AskUserQuestion");
  });

  // Codex's transcript is not Claude Code's format; the Stop payload's own copy
  // of the closing message is what the gate judges.
  it("capability-claim-gate: judges the closing message the Stop payload carries", () => {
    const blocked = JSON.parse(
      runHook("capability-claim-gate", {
        session_id: "cx-claim",
        transcript_path: null,
        last_assistant_message: "I can't test the magic link login flow end to end, since there is no inbox.",
      }),
    );
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain("live inbox");
  });

  it("capability-claim-gate: stays quiet on a closing message that claims nothing", () => {
    expect(
      runHook("capability-claim-gate", {
        session_id: "cx-quiet",
        transcript_path: null,
        last_assistant_message: "All three flows passed; the walkthrough is on the PR.",
      }),
    ).toBe("{}");
  });
});

// Lazy core: every gate reaches Node through guardrail-lib.sh's one runner, so the
// never-block guarantee (fall back to {}, swallow stderr) lives in exactly one place,
// and `run` isolates gates from each other once they share a process. The per-event
// fan-out collapse itself is capped in footprint/hook-footprint.test.ts.
describe("guardrail never-block fallback", () => {
  const LIB = "guardrail-lib.sh";

  it("the shared runner falls back to {} and swallows stderr", () => {
    const body = readFileSync(join(SCRIPTS, LIB), "utf-8");
    expect(body).toMatch(
      /node "\$\{root\}\/scripts\/guardrails\.mjs" "\$@" <<<"\$GUARDRAIL_PAYLOAD" 2>\/dev\/null \|\| printf '\{\}'/,
    );
  });

  it("no gate script calls Node except through the shared runner", () => {
    const scripts = readdirSync(SCRIPTS).filter((f) => f.startsWith("guardrail-") && f.endsWith(".sh") && f !== LIB);
    expect(scripts.length).toBeGreaterThan(0);
    for (const f of scripts) {
      expect(readFileSync(join(SCRIPTS, f), "utf-8"), `${f} must reach Node via guardrail_run_node`).not.toMatch(
        /^\s*[^#\n]*\bnode\s/m,
      );
    }
  });

  it("run: a throwing or unknown gate degrades to {} without silencing the others", () => {
    const cliRun = runGuardrailCli({
      home: createHookHome("gr-run-"),
      cliArgs: ["run", "no-such-gate", "build-router"],
      stdin: JSON.stringify({ session_id: "iso", prompt: "implement dark mode" }),
    });
    expect(cliRun.status).toBe(0);
    expect(JSON.parse(cliRun.stdout).hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  });
});

// The wrappers guard guardrails.mjs behind an in-shell keyword pre-filter so the
// common case (a prompt, a Bash call, a turn end that doesn't concern a guardrail)
// never pays Node cold-start — the fix for hooks stalling the turn on a loaded
// box. These run the real bash wrappers with `node` stubbed on PATH: a marker in
// the output proves Node ran; its absence proves the pre-filter short-circuited.
// Bash-only, so skipped on win32 (covered by the Linux/macOS platform-compat jobs).
describe.skipIf(process.platform === "win32")("guardrail wrapper pre-filter (no Node on the cold path)", () => {
  const NODE_RAN = "__STUB_NODE_RAN__";
  const event = (o: unknown): string => JSON.stringify(o);
  let root: string;
  let binDir: string;

  beforeEach(() => {
    root = dirname(SCRIPTS); // plugin/, so ${root}/scripts/guardrails.mjs resolves
    binDir = createStubProgramDirectory("node", `printf '%s' '${NODE_RAN}'\n`);
  });

  function runWrapper(script: string, stdin: string, seededState?: { sessionId: string } & Record<string, unknown>): string {
    const home = createHookHome("gr-home-");
    if (seededState) writeGuardrailState(home, seededState);
    const r = spawnSync("bash", [join(SCRIPTS, script)], {
      input: stdin,
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: pathWithDirectoryFirst(binDir),
        CLAUDE_PLUGIN_ROOT: root,
        HOME: home,
        USERPROFILE: home,
      },
    });
    return (r.stdout ?? "").trim();
  }

  // Codex always sends the closing message, so the gate judges it in-shell
  // without tailing a transcript (whose format is not Claude Code's anyway).
  it("capability-claim: judges a payload's closing message with no transcript to tail", () => {
    expect(
      runWrapper(
        "guardrail-capability-claim.sh",
        event({ session_id: "cm-a", transcript_path: null, last_assistant_message: "I cannot test the OTP login flow." }),
      ),
    ).toContain(NODE_RAN);
    expect(
      runWrapper(
        "guardrail-capability-claim.sh",
        event({ session_id: "cm-b", transcript_path: null, last_assistant_message: "All three flows passed." }),
      ),
    ).toBe("{}");
  });

  it("build-router: skips Node on a non-build prompt, spawns it on a build ask", () => {
    expect(runWrapper("guardrail-build-router.sh", event({ session_id: "a", prompt: "what time is it?" }))).toBe("{}");
    expect(runWrapper("guardrail-build-router.sh", event({ session_id: "b", prompt: "implement dark mode" }))).toContain(NODE_RAN);
  });

  // The offer fires once per session, so every later build ask would start Node only to answer {}.
  it("build-router: skips Node on a build ask once the session has been routed", () => {
    expect(
      runWrapper("guardrail-build-router.sh", event({ session_id: "routed", prompt: "implement dark mode" }), {
        sessionId: "routed",
        buildIntentRouted: true,
      }),
    ).toBe("{}");
  });

  it("record-delegation: skips Node for any other agent, spawns it for an acceptance-tester", () => {
    const dispatchOf = (subagentType: string): string =>
      event({ session_id: "d", tool_name: "Agent", tool_input: { subagent_type: subagentType, prompt: "go" } });
    expect(runWrapper("guardrail-record-delegation.sh", dispatchOf("general-purpose"))).toBe("{}");
    expect(runWrapper("guardrail-record-delegation.sh", dispatchOf("muggle:acceptance-tester"))).toContain(NODE_RAN);
  });

  it("pr-opened: skips Node on a plain command, spawns it on gh pr create", () => {
    expect(
      runWrapper("guardrail-pr-opened.sh", event({ tool_name: "Bash", tool_input: { command: "ls -la" } })),
    ).toBe("{}");
    expect(
      runWrapper("guardrail-pr-opened.sh", event({ tool_name: "Bash", tool_input: { command: "gh pr create --fill" } })),
    ).toContain(NODE_RAN);
  });

  it("report-format: skips Node on a plain command, spawns it on gh pr comment", () => {
    expect(
      runWrapper("guardrail-report-format.sh", event({ tool_name: "Bash", tool_input: { command: "git status" } })),
    ).toBe("{}");
    expect(
      runWrapper("guardrail-report-format.sh", event({ tool_name: "Bash", tool_input: { command: "gh pr comment 1 --body x" } })),
    ).toContain(NODE_RAN);
  });

  it("record-tests: skips Node on a plain command, spawns it on a test run", () => {
    expect(
      runWrapper("guardrail-record-tests.sh", event({ tool_name: "Bash", tool_input: { command: "git log" } })),
    ).toBe("{}");
    expect(
      runWrapper("guardrail-record-tests.sh", event({ tool_name: "Bash", tool_input: { command: "pnpm test" } })),
    ).toContain(NODE_RAN);
  });

  // skill-stages is the emit's one writer, so record-tests must stay off it.
  it("skill emit: spawns Node in skill-stages only, never in record-tests", () => {
    const skillEmit = event({
      tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-skill-emit",
      tool_input: { skillName: "muggle-test" },
    });
    expect(runWrapper("guardrail-skill-stages.sh", skillEmit)).toContain(NODE_RAN);
    expect(runWrapper("guardrail-record-tests.sh", skillEmit)).toBe("{}");
  });

  // Every Stop gate documents its own marker as the way out, so all three must
  // survive the pre-filter — a per-token list left two of them unreachable and
  // the gates blocked users who followed the instruction. hook-prefilter.test.ts
  // derives the token set from source; these confirm real grep agrees.
  it.each(["MUGGLE_E2E_SKIP", "MUGGLE_WATCH_SKIP", "MUGGLE_WALKTHROUGH_SKIP"])(
    "record-tests: spawns Node on the %s marker",
    (token) => {
      expect(
        runWrapper(
          "guardrail-record-tests.sh",
          event({ tool_name: "Bash", tool_input: { command: `echo "${token}: reason"` } }),
        ),
      ).toContain(NODE_RAN);
    },
  );

  it("record-tests: spawns Node on a walkthrough post so it registers without a provider lookup", () => {
    expect(
      runWrapper(
        "guardrail-record-tests.sh",
        event({ tool_name: "Bash", tool_input: { command: "gh pr comment 7 --body-file walkthrough.md" } }),
      ),
    ).toContain(NODE_RAN);
  });

  it("report-format: spawns Node on a gh api comment edit", () => {
    expect(
      runWrapper(
        "guardrail-report-format.sh",
        event({
          tool_name: "Bash",
          tool_input: { command: "gh api --method PATCH repos/o/r/issues/comments/1 -f body=@report.md" },
        }),
      ),
    ).toContain(NODE_RAN);
  });

  it("e2e-gate: skips Node when no armed state file exists for the session", () => {
    expect(runWrapper("guardrail-e2e-gate.sh", event({ session_id: "no-state" }))).toBe("{}");
  });

  // The pre-filter has to track shouldRunE2E's *second* trigger too. Keyed on
  // unitTestsGreen alone, a session that opened a PR without running tests never
  // spawned Node, so the widened gate would have been dead code.
  it("e2e-gate: spawns Node for a PR opened with no unit run, skips once E2E ran", () => {
    const openedPr = { sessionId: "pr", prsHandled: ["https://github.com/o/r/pull/7"] };
    expect(runWrapper("guardrail-e2e-gate.sh", event({ session_id: "pr" }), openedPr)).toContain(
      NODE_RAN,
    );
    expect(
      runWrapper("guardrail-e2e-gate.sh", event({ session_id: "pr" }), { ...openedPr, e2eRun: true }),
    ).toBe("{}");
  });

  // A Stop hook past its one-second cap is dropped and the turn ends unblocked, so an owed run's block must not wait
  // on Node's cold start.
  it("e2e-gate: returns the rendered block in-shell, without Node, until the shared budget is spent", () => {
    const home = createHookHome("gr-home-");
    const openedPr = { sessionId: "rendered", prsHandled: ["https://github.com/o/r/pull/7"], e2eBlockCount: 1 };
    writeGuardrailState(home, openedPr);
    const sidecar = (suffix: string): string => guardrailStateFile(home, "rendered").replace(/\.json$/, suffix);
    const renderedBlock = JSON.stringify({ decision: "block", reason: "run /muggle:muggle-test" });
    writeFileSync(sidecar(".e2e-stop-verdict"), `3\n${renderedBlock}`);
    const fireStop = (): string =>
      (
        spawnSync("bash", [join(SCRIPTS, "guardrail-e2e-gate.sh")], {
          input: event({ session_id: "rendered" }),
          encoding: "utf-8",
          env: { ...process.env, PATH: pathWithDirectoryFirst(binDir), CLAUDE_PLUGIN_ROOT: root, HOME: home, USERPROFILE: home },
        }).stdout ?? ""
      ).trim();

    expect(fireStop()).toBe(renderedBlock);
    expect(fireStop()).toBe(renderedBlock);
    expect(readFileSync(sidecar(".e2e-shell-blocks"), "utf-8")).toBe("xx");
    expect(fireStop()).toContain(NODE_RAN);
  });

  // shouldRunE2E clears the duty on an accepted skip, so a block rendered before the skip landed must not replay.
  it("e2e-gate: replays no rendered block and skips Node once a skip is accepted", () => {
    const home = createHookHome("gr-home-");
    const skipped = { sessionId: "skipped", prsHandled: ["https://github.com/o/r/pull/7"], e2eSkipped: true };
    writeGuardrailState(home, skipped);
    const renderedBlock = JSON.stringify({ decision: "block", reason: "run /muggle:muggle-test" });
    writeFileSync(guardrailStateFile(home, "skipped").replace(/\.json$/, ".e2e-stop-verdict"), `3\n${renderedBlock}`);
    const stdout = spawnSync("bash", [join(SCRIPTS, "guardrail-e2e-gate.sh")], {
      input: event({ session_id: "skipped" }),
      encoding: "utf-8",
      env: { ...process.env, PATH: pathWithDirectoryFirst(binDir), CLAUDE_PLUGIN_ROOT: root, HOME: home, USERPROFILE: home },
    }).stdout;

    expect((stdout ?? "").trim()).toBe("{}");
  });

  it("e2e-gate: skips Node for a session with neither a green unit run nor a PR", () => {
    expect(
      runWrapper("guardrail-e2e-gate.sh", event({ session_id: "idle" }), {
        sessionId: "idle",
        prsHandled: [],
      }),
    ).toBe("{}");
  });

  it("watch-gate: skips Node when no PR was opened this session", () => {
    expect(runWrapper("guardrail-watch-gate.sh", event({ session_id: "no-state" }))).toBe("{}");
  });

  it("walkthrough-gate: skips Node when no acceptance run is recorded", () => {
    expect(runWrapper("guardrail-walkthrough-gate.sh", event({ session_id: "no-state" }))).toBe("{}");
  });

  it("walkthrough-gate: spawns Node for an accepted skip until its record is settled on the PRs", () => {
    const skippedState = {
      sessionId: "wt-skip",
      prsHandled: ["https://github.com/o/r/pull/5"],
      e2eSkipped: true,
      e2eSkipDeclaration: { code: E2eSkipCode.NoWebSurface, detail: "a CLI" },
    };
    expect(runWrapper("guardrail-walkthrough-gate.sh", event({ session_id: "wt-skip" }), skippedState)).toContain(NODE_RAN);
    expect(
      runWrapper("guardrail-walkthrough-gate.sh", event({ session_id: "wt-skip" }), { ...skippedState, e2eSkipSettledOnPrs: true }),
    ).toBe("{}");
    expect(
      runWrapper("guardrail-walkthrough-gate.sh", event({ session_id: "wt-skip" }), { ...skippedState, walkthroughReleased: true }),
    ).toBe("{}");
  });

  it("pr-terminal: skips Node on a plain command, spawns it on a merge success line", () => {
    expect(
      runWrapper("guardrail-pr-terminal.sh", event({ tool_name: "Bash", tool_input: { command: "git status" } })),
    ).toBe("{}");
    expect(
      runWrapper(
        "guardrail-pr-terminal.sh",
        event({ tool_name: "Bash", tool_response: { stderr: "✓ Merged pull request #341 (x)" } }),
      ),
    ).toContain(NODE_RAN);
    expect(
      runWrapper(
        "guardrail-pr-terminal.sh",
        event({ tool_name: "Bash", tool_response: { stdout: "TERMINAL pr=331 state=MERGED" } }),
      ),
    ).toContain(NODE_RAN);
  });

  // The reopen retracts a close, so it must reach the detector — while the
  // pre-filter dropped it, a routine close+reopen left the post-merge handoff
  // armed on a PR that is open again.
  it("pr-terminal: spawns Node on a reopen success line", () => {
    expect(
      runWrapper(
        "guardrail-pr-terminal.sh",
        event({ tool_name: "Bash", tool_response: { stderr: "✓ Reopened pull request o/r#369 (gate fix)" } }),
      ),
    ).toContain(NODE_RAN);
  });

  it("terminal-gate and offer-ran: skip Node when no terminal PR is pending", () => {
    expect(runWrapper("guardrail-terminal-gate.sh", event({ session_id: "no-state" }))).toBe("{}");
    expect(
      runWrapper("guardrail-offer-ran.sh", event({ session_id: "no-state", tool_name: "AskUserQuestion" })),
    ).toBe("{}");
  });
});

describe("hooks.json fan-out (Lazy-core tripwire)", () => {
  type HookGroup = { matcher?: string; hooks: Array<{ command: string }> };
  const hooks = (JSON.parse(readFileSync(HOOKS, "utf-8")) as { hooks: Record<string, HookGroup[]> }).hooks;

  it("registers the expected guardrail events", () => {
    expect(Object.keys(hooks).sort()).toEqual(
      ["PostToolUse", "PreToolUse", "SessionStart", "Stop", "UserPromptSubmit"].sort(),
    );
  });

  // Matched as a regex, not compared as a literal: the group covers every shell
  // a session can run a command through, so pinning one name would fail the day
  // a second shell is added — which is exactly when the assertion matters.
  const shellGroup = (groups: HookGroup[]): HookGroup | undefined =>
    groups.find((g) => g.matcher !== undefined && new RegExp(`^(?:${g.matcher})$`).test("Bash"));

  it("covers every shell a command can run through", () => {
    for (const event of [hooks.PostToolUse, hooks.PreToolUse]) {
      const matcher = shellGroup(event)?.matcher;
      expect(matcher).toBeDefined();
      expect(new RegExp(`^(?:${matcher})$`).test("PowerShell")).toBe(true);
    }
  });

  it("drives one dispatcher on a shell PostToolUse, feeding all five observers (pr-opened + record-tests + pr-terminal + stage-signals + comment-replies)", () => {
    const bash = shellGroup(hooks.PostToolUse);
    expect(bash).toBeDefined();
    // The group's `if` variants all launch this one command, each for the calls its rule names.
    const cmds = [...new Set(bash!.hooks.map((h) => h.command))];
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toContain("guardrail-dispatch.sh");
    expect(cmds.some((c) => c.includes("guardrail-pr-opened.sh"))).toBe(true);
    expect(cmds.some((c) => c.includes("guardrail-record-tests.sh"))).toBe(true);
    expect(cmds.some((c) => c.includes("guardrail-pr-terminal.sh"))).toBe(true);
    expect(cmds.some((c) => c.includes("guardrail-record-stage-signals.sh"))).toBe(true);
    expect(cmds.some((c) => c.includes("guardrail-record-comment-replies.sh"))).toBe(true);
  });

  it("stands both shell PreToolUse denials in front of every command (report-format + resolve-gate)", () => {
    const bash = shellGroup(hooks.PreToolUse);
    expect(bash).toBeDefined();
    const cmds = bash!.hooks.map((h) => h.command);
    expect(cmds.some((c) => c.includes("guardrail-report-format.sh"))).toBe(true);
    expect(cmds.some((c) => c.includes("guardrail-resolve-gate.sh"))).toBe(true);
  });

  // A Monitor call returns as its script starts; every line it prints arrives later as a notification, so the
  // call's PostToolUse result never carries a terminal line and a hook there would only cost a launch per watch.
  it("fires the offer observer on AskUserQuestion, the delegation recorder on Agent/Task, and registers nothing on Monitor", () => {
    const ask = hooks.PostToolUse.find((g) => g.matcher.split("|").includes("AskUserQuestion"));
    expect(ask!.matcher.split("|").sort()).toEqual(["Agent", "AskUserQuestion", "Task"]);
    expect(ask!.hooks.map((h) => h.command)).toEqual([
      expect.stringMatching(/guardrail-offer-ran\.sh.*guardrail-record-delegation\.sh/),
    ]);
    expect(hooks.PostToolUse.find((g) => g.matcher?.split("|").includes("Monitor"))).toBeUndefined();
  });

  it("runs all five gates on Stop (e2e + post-merge handoff + watcher-arm + walkthrough + comment-reply)", () => {
    const stop = hooks.Stop[0].hooks.map((h) => h.command);
    expect(stop.some((c) => c.includes("guardrail-e2e-gate.sh"))).toBe(true);
    expect(stop.some((c) => c.includes("guardrail-terminal-gate.sh"))).toBe(true);
    expect(stop.some((c) => c.includes("guardrail-watch-gate.sh"))).toBe(true);
    expect(stop.some((c) => c.includes("guardrail-walkthrough-gate.sh"))).toBe(true);
    expect(stop.some((c) => c.includes("guardrail-comment-reply-gate.sh"))).toBe(true);
  });

  // A gate that spends its block budget and releases keeps cold-starting Node
  // on every remaining turn end to answer "{}" — and the walkthrough gate keeps
  // making provider calls to do it — unless the release is stamped for its
  // wrapper to pre-filter on. Derived from source rather than hand-listed, so a
  // release-capable gate added later is covered the moment it exists. Gates with
  // no block budget (the capability-claim nudge) never release and need no flag.
  it("every release-capable gate stamps a flag, and every flag is pre-filtered on", () => {
    const cliBody = readFileSync(GUARDRAIL_CLI_ENTRY, "utf-8");
    const stampedFlags = [...cliBody.matchAll(/releaseGate\("(\w+)"\)/g)].map(([, field]) => field);
    const releaseBranches = [...cliBody.matchAll(/Action\.Release/g)].length;

    expect(stampedFlags.length).toBeGreaterThanOrEqual(7);
    expect(releaseBranches, "a gate reaches Release without stamping it").toBe(stampedFlags.length);

    // The rewake companion runs the same gates as the dispatcher, so each gate is read once.
    const stopWrapperNames = hooks.Stop[0].hooks
      .flatMap((h) => [...h.command.matchAll(/guardrail-[a-z0-9-]+\.sh/g)].map(([name]) => name))
      .filter((name) => name !== "guardrail-dispatch.sh" && name !== "guardrail-rewake.sh");
    const stopWrapperBodies = [...new Set(stopWrapperNames)].map((name) => readFileSync(join(SCRIPTS, name), "utf-8"));

    for (const field of stampedFlags) {
      const greped = stopWrapperBodies.filter((body) => body.includes(`"${field}": true`));
      expect(greped, `${field} is stamped but no Stop wrapper pre-filters on it`).toHaveLength(1);
    }
  });
});

// The walkthrough gate is the one gate that reads provider state at turn end, so
// its lookups are exercised against a stubbed `gh` rather than the network.
// Bash-only, so skipped on win32 (covered by the Linux/macOS platform-compat jobs).
describe.skipIf(process.platform === "win32")("walkthrough gate provider lookups", () => {
  const PR_URL = "https://github.com/o/r/pull/5";
  let binDir: string;

  beforeEach(() => {
    binDir = createWalkthroughProbeGhStub();
  });

  function seedArmedSession(sessionId: string): string {
    const home = createHookHome("gr-wt-");
    writeGuardrailState(home, { sessionId: sessionId, prsHandled: [], e2eRun: true });
    return home;
  }

  function runCli(home: string, cliArgs: string[], stdin: string, prContent: string, prUrl: string): string {
    return runGuardrailCli({
      home: home,
      cliArgs: cliArgs,
      stdin: stdin,
      env: {
        ...process.env,
        PATH: pathWithDirectoryFirst(binDir),
        ...walkthroughProbeAnswerEnvironment({ branchPrUrl: prUrl, prContentJson: prContent }),
      },
    }).stdout;
  }

  // The gate decides on the scan the detached job left, so the job runs to completion first.
  function runGate(sessionId: string, prContent: string, prUrl: string = PR_URL): string {
    const home = seedArmedSession(sessionId);
    runCli(home, ["scan-walkthroughs", sessionId], "", prContent, prUrl);
    return runCli(home, ["walkthrough-gate"], JSON.stringify({ session_id: sessionId }), prContent, prUrl);
  }

  it("stays open until a scan lands, and starts one for the next turn end", async () => {
    const sessionId = "wt-unscanned";
    const home = seedArmedSession(sessionId);
    const gateOutput = runCli(home, ["walkthrough-gate"], JSON.stringify({ session_id: sessionId }), '{"body":"x","comments":[]}', PR_URL);
    expect(gateOutput).toBe("{}");
    const scanFile = join(home, ".muggle-ai", "guardrails", `${sessionId}.walkthrough-scan.json`);
    await vi.waitFor(() => expect(existsSync(scanFile)).toBe(true), { timeout: 30_000, interval: 200 });
    expect(JSON.parse(readFileSync(scanFile, "utf-8")).owed).toEqual([PR_URL]);
  });

  it("blocks when the branch's PR carries no walkthrough", () => {
    const blocked = JSON.parse(runGate("wt-block", '{"body":"a feature","comments":[]}'));
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain(PR_URL);
    expect(blocked.reason).toContain("MUGGLE_WALKTHROUGH_SKIP");
  });

  it("stays silent when the PR already carries a walkthrough comment", () => {
    expect(runGate("wt-comment", '{"body":"x","comments":[{"body":"<!-- muggle-pr-section:v1 -->"}]}')).toBe("{}");
  });

  // muggle-do embeds the walkthrough in the description at PR-creation time.
  it("stays silent when the walkthrough is embedded in the PR description", () => {
    expect(runGate("wt-body", '{"body":"<!-- muggle-pr-section:v1 -->","comments":[]}')).toBe("{}");
  });

  it("fails open when no PR can be resolved for the branch", () => {
    expect(runGate("wt-nopr", "", "")).toBe("{}");
  });

  // An accepted skip only reaches the PR through a detached write; the gate is
  // what notices when it never landed. The state is what the hooks write when
  // the skip and the PR are one change — or, uncovered, two.
  function runSkippedSessionGate(
    sessionId: string,
    prContent: string,
    isPrOfSkipChange: boolean = true,
    isCoveredByEarlierSkip: boolean = false,
  ): { output: string; home: string } {
    const home = createHookHome("gr-wt-skip-");
    const skipChange = { repo: "github.com/o/r", branch: "fix-login" };
    writeGuardrailState(home, {
      sessionId: sessionId,
      prsHandled: [PR_URL],
      e2eSkipped: true,
      e2eSkipDeclaration: { code: E2eSkipCode.NoWebSurface, detail: "a CLI with no web app" },
      e2eSkipVerifiedChange: skipChange,
      prChanges: { [PR_URL]: isPrOfSkipChange ? skipChange : { ...skipChange, branch: "fix-export" } },
      e2eSkipCoveredPrs: isPrOfSkipChange || isCoveredByEarlierSkip ? [PR_URL] : [],
    });
    runCli(home, ["scan-walkthroughs", sessionId], "", prContent, PR_URL);
    return { output: runCli(home, ["walkthrough-gate"], JSON.stringify({ session_id: sessionId }), prContent, PR_URL), home: home };
  }

  it("holds an accepted skip until the PR shows it, handing over the foreground settle", () => {
    const placeholder = JSON.stringify({ body: "x", comments: [{ body: "<!-- muggle-pr-walkthrough:v1 -->\nAwaiting the E2E acceptance run." }] });
    const blocked = JSON.parse(runSkippedSessionGate("wt-skip-pending", placeholder).output);
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain("NO_WEB_SURFACE");
    expect(blocked.reason).toContain(`settle-walkthrough-skipped ${PR_URL} wt-skip-pending`);
  });

  it("tells a PR from another working tree to get its own run, never handing it another change's skip", () => {
    const placeholder = JSON.stringify({ body: "x", comments: [{ body: "<!-- muggle-pr-walkthrough:v1 -->\nAwaiting the E2E acceptance run." }] });
    const blocked = JSON.parse(runSkippedSessionGate("wt-skip-other-tree", placeholder, false).output);
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain(PR_URL);
    expect(blocked.reason).toContain("its own change");
    expect(blocked.reason).not.toContain("settle-walkthrough-skipped");
  });

  it("never hands a PR an earlier skip covered the record of a later skip for another change", () => {
    const placeholder = JSON.stringify({ body: "x", comments: [{ body: "<!-- muggle-pr-walkthrough:v1 -->\nAwaiting the E2E acceptance run." }] });
    const blocked = JSON.parse(runSkippedSessionGate("wt-skip-earlier-change", placeholder, false, true).output);
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain(PR_URL);
    expect(blocked.reason).not.toContain("settle-walkthrough-skipped");
  });

  it("goes quiet once the PR carries the skip's record, and remembers it", () => {
    const settled = JSON.stringify({
      body: "x",
      comments: [{ body: "<!-- muggle-pr-walkthrough:v1 -->\n<!-- muggle-pr-walkthrough-status:skipped -->\nE2E did not run." }],
    });
    const { output, home } = runSkippedSessionGate("wt-skip-settled", settled);
    expect(output).toBe("{}");
    expect(JSON.parse(readFileSync(guardrailStateFile(home, "wt-skip-settled"), "utf-8")).e2eSkipSettledOnPrs).toBe(true);
  });
});

// The watch gate's provider check clears a PR that merged after its slot was
// cleaned up. Its lookup runs in a detached scan, exercised here against a
// stubbed `gh`. Bash-only, so skipped on win32 like the walkthrough block above.
describe.skipIf(process.platform === "win32")("watch gate provider lookups", () => {
  const CLI_ENTRY = fileURLToPath(new URL("../../guardrails/cli.ts", import.meta.url));
  const PR_URL = "https://github.com/o/r/pull/233";
  let binDir: string;

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "gr-gh-"));
    const stub = join(binDir, "gh");
    writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s\\n' "$STUB_PR_STATE"\n`);
    chmodSync(stub, 0o755);
  });

  function runCli(home: string, cliArgs: string[], stdin: string, prState: string): string {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
      HOME: home,
      USERPROFILE: home,
      STUB_PR_STATE: prState,
    };
    // The suite turns provider calls off; this block's gh is a stub, so let it answer.
    delete env.MUGGLE_GUARDRAIL_GH_CALLS;
    const r = spawnSync(process.execPath, ["--import", "tsx", CLI_ENTRY, ...cliArgs], {
      input: stdin,
      encoding: "utf-8",
      env: env,
    });
    return (r.stdout ?? "").trim();
  }

  // A handled PR with no slot at all — the state post-merge cleanup leaves behind.
  function runGateAfterScan(sessionId: string, prState: string): { gateOutput: string; scan: unknown } {
    const home = mkdtempSync(join(tmpdir(), "gr-watch-"));
    mkdirSync(join(home, ".muggle-ai", "guardrails"), { recursive: true });
    writeFileSync(
      join(home, ".muggle-ai", "guardrails", `${sessionId}.json`),
      JSON.stringify({ sessionId: sessionId, prsHandled: [PR_URL] }),
    );
    runCli(home, ["scan-watch-pr-states", sessionId], "", prState);
    const scanFile = join(home, ".muggle-ai", "guardrails", `${sessionId}.pr-state-scan.json`);
    const scan = existsSync(scanFile) ? JSON.parse(readFileSync(scanFile, "utf-8")) : null;
    const gateOutput = runCli(home, ["watch-gate"], JSON.stringify({ session_id: sessionId }), prState);
    return { gateOutput: gateOutput, scan: scan };
  }

  it("stays silent for a PR the provider reports merged", () => {
    const { gateOutput, scan } = runGateAfterScan("watch-provider-merged", "MERGED");
    expect(scan).toEqual({ states: { [PR_URL]: "MERGED" } });
    expect(gateOutput).toBe("{}");
  });

  it("blocks for a PR the provider reports open", () => {
    const { gateOutput, scan } = runGateAfterScan("watch-provider-open", "OPEN");
    expect(scan).toEqual({ states: { [PR_URL]: "OPEN" } });
    expect(JSON.parse(gateOutput).decision).toBe("block");
  });
});
