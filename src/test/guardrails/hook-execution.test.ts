import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, dirname, join } from "path";

// End-to-end hook contract. The per-function guardrail logic is unit-tested
// elsewhere; this file exercises the *entry* the way Claude Code runs it —
// stdin = event JSON, argv[2] = subcommand, stdout = the hook's JSON response —
// by running the real source entry (src/guardrails/cli.ts) as a subprocess.
// It pins stdin parsing, subcommand dispatch, cross-hook state I/O, and stdout
// emission: the observable contract the "Lazy core" footprint refactor must
// preserve when it drops the bash wrappers and collapses the per-event fan-out.
const CLI = fileURLToPath(new URL("../../guardrails/cli.ts", import.meta.url));
const SCRIPTS = fileURLToPath(new URL("../../../plugin/scripts", import.meta.url));
const HOOKS = fileURLToPath(new URL("../../../plugin/hooks/hooks.json", import.meta.url));

describe("guardrail hook execution (cli entry)", () => {
  let home: string;
  beforeEach(() => {
    // sessionState persists under os.homedir(); redirect it to a throwaway dir
    // so a hook run never touches the real ~/.muggle-ai and tests stay isolated.
    home = mkdtempSync(join(tmpdir(), "gr-hook-"));
  });

  function runHook(sub: string, stdin: string): { status: number | null; out: string } {
    const r = spawnSync(process.execPath, ["--import", "tsx", CLI, sub], {
      input: stdin,
      encoding: "utf-8",
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    return { status: r.status, out: (r.stdout ?? "").trim() };
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
    expect(gate.reason).toContain("no muggle-do session slot tracks it");
    expect(gate.reason).toContain("https://github.com/o/r/pull/77");
    expect(gate.reason).toContain("MUGGLE_WATCH_SKIP");
  });

  // Seeding the slot is the hand-off the gate asks for; arming is reconcile's
  // job from there. A background job legitimately ends seeded-but-unarmed, and
  // the gate firing on that state pushed the caller into the skip hatch.
  it("watch-gate: silent once a slot tracks the opened PR, even with no watcher armed", () => {
    const session = "watch-seeded";
    const url = "https://github.com/o/r/pull/78";
    runHook(
      "pr-opened",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "gh pr create" },
        tool_response: { stdout: `${url}\n` },
      }),
    );
    expect(JSON.parse(runHook("watch-gate", event({ session_id: session })).out).decision).toBe("block");

    const slot = join(home, ".muggle-ai", "muggle-do", "sessions", "r-pr78");
    mkdirSync(slot, { recursive: true });
    writeFileSync(join(slot, "prs.json"), JSON.stringify([{ url: url }]));
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

  it("record-tests -> walkthrough-gate: a sentinel-carrying post settles the gate", () => {
    const session = "walkthrough-posted";
    runHook(
      "record-tests",
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

  it("record-tests -> walkthrough-gate: a MUGGLE_WALKTHROUGH_SKIP marker settles the gate", () => {
    const session = "walkthrough-skip";
    runHook(
      "record-tests",
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

  it("record-tests -> e2e-gate: an explicit skip marker releases an armed gate", () => {
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
        tool_input: { command: 'echo "MUGGLE_E2E_SKIP: CLI package, no web surface to drive"' },
        tool_response: { stdout: "MUGGLE_E2E_SKIP: CLI package, no web surface to drive" },
      }),
    );
    expect(runHook("e2e-gate", event({ session_id: session })).out).toBe("{}");
  });

  it("record-tests -> e2e-gate: a muggle-test skill emit (clean SKIP path) releases an armed gate", () => {
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
      "record-tests",
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

  it("build-router: nudges a build ask toward muggle-do, once per session", () => {
    const ev = event({ session_id: "br", prompt: "implement a dark-mode toggle" });
    const first = JSON.parse(runHook("build-router", ev).out);
    expect(first.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(first.hookSpecificOutput.additionalContext).toContain("muggle-do");
    expect(runHook("build-router", ev).out).toBe("{}"); // deduped within the session
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
    const slotPath = join(home, ".muggle-ai", "muggle-do", "sessions", "slug");
    mkdirSync(slotPath, { recursive: true });
    writeFileSync(join(slotPath, "prs.json"), JSON.stringify([{ url: PR_URL }]));
    mkdirSync(join(home, ".muggle-ai", "guardrails"), { recursive: true });
    writeFileSync(
      join(home, ".muggle-ai", "guardrails", `${sid}.json`),
      JSON.stringify({ sessionId: sid, prsHandled: [PR_URL] }),
    );
    return slotPath;
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

// Lazy-core tripwires. These pin the two things the footprint refactor changes —
// the bash-wrapper "never block" fallback and the per-event fan-out — so either
// change is a conscious, reviewed diff rather than a silent behavior shift. When
// Lazy core lands, update these alongside it (e.g. assert the never-block
// guarantee now lives in guardrails.mjs, and the Bash event drives one observer).
describe("guardrail wrapper never-block fallback (Lazy-core tripwire)", () => {
  it("every wrapper that calls guardrails.mjs falls back to {} and swallows stderr", () => {
    const wrappers = readdirSync(SCRIPTS).filter((f) => f.startsWith("guardrail-") && f.endsWith(".sh"));
    expect(wrappers.length).toBeGreaterThan(0);
    for (const f of wrappers) {
      const body = readFileSync(join(SCRIPTS, f), "utf-8");
      if (!body.includes("guardrails.mjs")) continue;
      expect(body, `${f} must keep its never-block fallback`).toContain("printf '{}'");
      expect(body, `${f} must swallow guardrail stderr`).toContain("2>/dev/null");
    }
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
    binDir = mkdtempSync(join(tmpdir(), "gr-stub-"));
    const stub = join(binDir, "node");
    writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s' '${NODE_RAN}'\n`);
    chmodSync(stub, 0o755);
  });

  function runWrapper(script: string, stdin: string): string {
    const home = mkdtempSync(join(tmpdir(), "gr-home-"));
    const r = spawnSync("bash", [join(SCRIPTS, script)], {
      input: stdin,
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CLAUDE_PLUGIN_ROOT: root,
        HOME: home,
        USERPROFILE: home,
      },
    });
    return (r.stdout ?? "").trim();
  }

  it("build-router: skips Node on a non-build prompt, spawns it on a build ask", () => {
    expect(runWrapper("guardrail-build-router.sh", event({ session_id: "a", prompt: "what time is it?" }))).toBe("{}");
    expect(runWrapper("guardrail-build-router.sh", event({ session_id: "b", prompt: "implement dark mode" }))).toContain(NODE_RAN);
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

  it("record-tests: spawns Node on a muggle-test skill telemetry emit", () => {
    expect(
      runWrapper(
        "guardrail-record-tests.sh",
        event({
          tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-skill-emit",
          tool_input: { skillName: "muggle-test" },
        }),
      ),
    ).toContain(NODE_RAN);
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

  it("watch-gate: skips Node when no PR was opened this session", () => {
    expect(runWrapper("guardrail-watch-gate.sh", event({ session_id: "no-state" }))).toBe("{}");
  });

  it("walkthrough-gate: skips Node when no acceptance run is recorded", () => {
    expect(runWrapper("guardrail-walkthrough-gate.sh", event({ session_id: "no-state" }))).toBe("{}");
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
        event({ tool_name: "Bash", tool_response: { stdout: "TERMINAL pr=331: MERGED" } }),
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

  it("fires exactly five observers on a Bash PostToolUse (pr-opened + record-tests + pr-terminal + stage-signals + comment-replies)", () => {
    const bash = hooks.PostToolUse.find((g) => g.matcher === "Bash");
    expect(bash).toBeDefined();
    const cmds = bash!.hooks.map((h) => h.command);
    expect(cmds).toHaveLength(5);
    expect(cmds.some((c) => c.includes("guardrail-pr-opened.sh"))).toBe(true);
    expect(cmds.some((c) => c.includes("guardrail-record-tests.sh"))).toBe(true);
    expect(cmds.some((c) => c.includes("guardrail-pr-terminal.sh"))).toBe(true);
    expect(cmds.some((c) => c.includes("guardrail-record-stage-signals.sh"))).toBe(true);
    expect(cmds.some((c) => c.includes("guardrail-record-comment-replies.sh"))).toBe(true);
  });

  it("stands both Bash PreToolUse denials in front of every command (report-format + resolve-gate)", () => {
    const bash = hooks.PreToolUse.find((g) => g.matcher === "Bash");
    expect(bash).toBeDefined();
    const cmds = bash!.hooks.map((h) => h.command);
    expect(cmds.some((c) => c.includes("guardrail-report-format.sh"))).toBe(true);
    expect(cmds.some((c) => c.includes("guardrail-resolve-gate.sh"))).toBe(true);
  });

  it("fires the offer observer on AskUserQuestion and the terminal detector on Monitor", () => {
    const ask = hooks.PostToolUse.find((g) => g.matcher === "AskUserQuestion");
    expect(ask!.hooks.map((h) => h.command)).toEqual([
      expect.stringContaining("guardrail-offer-ran.sh"),
    ]);
    const monitor = hooks.PostToolUse.find((g) => g.matcher === "Monitor");
    expect(monitor!.hooks.map((h) => h.command)).toEqual([
      expect.stringContaining("guardrail-pr-terminal.sh"),
    ]);
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
    const cliBody = readFileSync(fileURLToPath(new URL("../../guardrails/cli.ts", import.meta.url)), "utf-8");
    const stampedFlags = [...cliBody.matchAll(/releaseGate\("(\w+)"\)/g)].map(([, field]) => field);
    const releaseBranches = [...cliBody.matchAll(/Action\.Release/g)].length;

    expect(stampedFlags.length).toBeGreaterThanOrEqual(7);
    expect(releaseBranches, "a gate reaches Release without stamping it").toBe(stampedFlags.length);

    const stopWrapperBodies = hooks.Stop[0].hooks
      .map((h) => h.command.match(/guardrail-[a-z0-9-]+\.sh/)?.[0])
      .filter((name): name is string => name !== undefined)
      .map((name) => readFileSync(join(SCRIPTS, name), "utf-8"));

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
  const CLI_ENTRY = fileURLToPath(new URL("../../guardrails/cli.ts", import.meta.url));
  const PR_URL = "https://github.com/o/r/pull/5";
  let binDir: string;

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "gr-gh-"));
    const stub = join(binDir, "gh");
    // `--json body,comments` is the walkthrough probe; anything else is the
    // branch-PR lookup, which prints the url alone.
    writeFileSync(
      stub,
      `#!/usr/bin/env bash\nfor a in "$@"; do\n  if [ "$a" = "body,comments" ]; then printf '%s' "$STUB_PR_CONTENT"; exit 0; fi\ndone\nprintf '%s' "$STUB_PR_URL"\n`,
    );
    chmodSync(stub, 0o755);
  });

  function runGate(sessionId: string, prContent: string, prUrl: string = PR_URL): string {
    const home = mkdtempSync(join(tmpdir(), "gr-wt-"));
    mkdirSync(join(home, ".muggle-ai", "guardrails"), { recursive: true });
    writeFileSync(
      join(home, ".muggle-ai", "guardrails", `${sessionId}.json`),
      JSON.stringify({ sessionId: sessionId, prsHandled: [], e2eRun: true }),
    );
    const r = spawnSync(process.execPath, ["--import", "tsx", CLI_ENTRY, "walkthrough-gate"], {
      input: JSON.stringify({ session_id: sessionId }),
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        HOME: home,
        USERPROFILE: home,
        STUB_PR_URL: prUrl,
        STUB_PR_CONTENT: prContent,
      },
    });
    return (r.stdout ?? "").trim();
  }

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
});
