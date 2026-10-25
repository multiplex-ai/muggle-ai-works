import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { detectPrTerminal } from "../../guardrails/prTerminal.js";
import { PrTerminalVerdict } from "../../guardrails/types.js";

const toBash = (p: string) => p.replace(/\\/g, "/");

const armPath = toBash(fileURLToPath(new URL("../../../plugin/scripts/pr-watch-arm.sh", import.meta.url)));
const loopPath = toBash(fileURLToPath(new URL("../../../plugin/scripts/pr-watch-loop.sh", import.meta.url)));
const guardsPath = toBash(
  fileURLToPath(new URL("../../../plugin/scripts/pr-watch-guards.sh", import.meta.url)),
);

let hasBash = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
} catch {
  // bash unavailable — the suite below skips
}

let hasJq = false;
try {
  execFileSync("jq", ["--version"], { stdio: "ignore" });
  hasJq = true;
} catch {
  // jq unavailable — the suites that run the real projection skip
}

// Runs the arm script and returns its exit status. Only argument handling is
// exercised here: everything past validation needs a live PR.
function runArm(args: string[]): number {
  try {
    execFileSync("bash", [armPath, ...args], { stdio: "ignore" });
    return 0;
  } catch (e: unknown) {
    return (e as { status?: number }).status ?? 1;
  }
}

describe.skipIf(!hasBash)("pr-watch-arm.sh arguments", () => {
  it("refuses to run with no arguments", () => {
    expect(runArm([])).toBe(2);
  });

  it("refuses a partial slot specification", () => {
    expect(runArm(["--slot", "/tmp/whatever", "--repo", "owner/name"])).toBe(2);
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(
      runArm(["--slot", "/tmp/x", "--repo", "o/n", "--pr", "1", "--base", "master", "--wat"]),
    ).toBe(2);
  });
});

describe.skipIf(!hasBash)("pr-watch-arm.sh contract", () => {
  const body = readFileSync(armPath, "utf8");

  // The whole point of the script: the three arming steps cannot be performed
  // separately, because performing them separately is how the watermark got
  // dropped and the watch became a silent no-op.
  it("seeds every watermark key the loop reads", () => {
    ["REV=", "COM=", "THREADS=", "CIRED=", "REBASED=", "BLOCKED_CIDIGEST="].forEach((key) => {
      expect(body).toContain(key);
    });
  });

  it("writes the watermark into the slot", () => {
    expect(body).toContain("watch-watermark.env");
  });

  it("hands over to the loop rather than reimplementing it", () => {
    expect(body).toContain("pr-watch-loop.sh");
    expect(body).toContain("exec bash");
  });

  // A merged or closed PR has nothing to watch, and arming one would leave a
  // slot that never terminates because its first fetch already passed.
  it("stops on a terminal PR instead of arming", () => {
    expect(body).toContain("TERMINAL pr=");
  });

  // Seeding floors from a failed read would mark the entire backlog as seen.
  it("refuses to seed floors it could not read", () => {
    expect(body).toContain("ARM-FAIL");
  });
});

// The claim happens after the state fetch, so reaching it needs the two calls
// arming makes: the tab-separated state projection and the behind-by compare.
// `prState` is the PR state the projection reports and `ciDigest` its check
// digest. The line is served from a file so a digest's quotes and `$` reach the
// script byte for byte rather than through the stub's own quoting.
function stubGhDir(prState = "OPEN", ciDigest = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "pr-watch-gh-"));
  const stateLinePath = join(dir, "state.tsv");
  writeFileSync(stateLinePath, `${prState}\tHEAD1\tBASE1\tMERGEABLE\t0\t0\t\t0\t0\t${ciDigest}\n`);
  const gh = join(dir, "gh");
  writeFileSync(
    gh,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "auth" ]; then echo stub-token; exit 0; fi',
      'if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then',
      `  cat "${toBash(stateLinePath)}"`,
      "  exit 0",
      "fi",
      "echo 0",
      "",
    ].join("\n"),
  );
  chmodSync(gh, 0o755);
  return dir;
}

// Arms a fresh slot with --no-exec and returns it. An omitted `session` runs the
// script with CLAUDE_CODE_SESSION_ID absent from the environment entirely.
//
// PATH is joined with the platform delimiter and native paths: a POSIX-joined
// PATH breaks locating `bash` itself on Windows, long before the stub matters.
function armSlot(session?: string): string {
  const slot = mkdtempSync(join(tmpdir(), "pr-watch-slot-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${stubGhDir()}${delimiter}${process.env.PATH ?? ""}`,
  };
  delete env.CLAUDE_CODE_SESSION_ID;
  if (session !== undefined) env.CLAUDE_CODE_SESSION_ID = session;
  execFileSync(
    "bash",
    [armPath, "--slot", toBash(slot), "--repo", "o/n", "--pr", "1", "--base", "master", "--no-exec"],
    { env: env, stdio: "ignore" },
  );
  return slot;
}

// Seeds the pid from inside bash: Git Bash's `kill -0` resolves MSYS pids, not
// Win32 ones, so a Node pid reads as dead and the guard sees no live lease.
function leaseIsForeign(slot: string, currentSession: string): boolean {
  try {
    execFileSync(
      "bash",
      [
        "-c",
        'source "$SCRIPT"; echo $$ > "$SLOT/watch.pid"; watcher_lease_is_foreign "$SLOT" "$CURRENT"',
      ],
      {
        env: { ...process.env, SCRIPT: guardsPath, SLOT: toBash(slot), CURRENT: currentSession },
        stdio: "ignore",
      },
    );
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasBash)("pr-watch-arm.sh slot ownership", () => {
  it("claims the slot for the arming session", () => {
    const owner = JSON.parse(readFileSync(join(armSlot("session-abc"), "owner.json"), "utf8"));
    expect(owner.session_id).toBe("session-abc");
    expect(owner.claimed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  // An unknowable id is worse than none: reconcile reads any id it does not
  // recognise as another session's claim, so a placeholder strands the slot.
  it("leaves the slot unowned when the session id is unset", () => {
    expect(existsSync(join(armSlot(), "owner.json"))).toBe(false);
  });

  it("registers an owned slot with the watch service", () => {
    const registration = JSON.parse(readFileSync(join(armSlot("session-abc"), "watch-registration.json"), "utf8"));
    expect(registration.registered_by).toBe("pr-watch-arm");
    expect(registration.registered_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  // Recovery resumes the owner; a slot with no owner has nobody to resume.
  it("leaves an unowned slot unregistered", () => {
    expect(existsSync(join(armSlot(), "watch-registration.json"))).toBe(false);
  });

  // The defect this claim closes. Without owner.json the guard reads a live
  // lease as "not foreign", so every later arm skips the slot as already owned
  // and an orphaned watcher holds it until the lifetime cap.
  it("writes an owner a later session can reclaim", () => {
    expect(leaseIsForeign(armSlot("session-abc"), "session-xyz")).toBe(true);
  });

  it("does not hand the arming session its own lease as foreign", () => {
    expect(leaseIsForeign(armSlot("session-abc"), "session-abc")).toBe(false);
  });
});

// Arms a slot and lets the loop run to its own exit, returning what it printed
// and how long it took. `window` and `interval` are seconds.
function runWatch(window: number, interval: number): { stdout: string; seconds: number } {
  const slot = mkdtempSync(join(tmpdir(), "pr-watch-slot-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${stubGhDir()}${delimiter}${process.env.PATH ?? ""}`,
    MUGGLE_PR_WATCH_MONITOR_WINDOW: String(window),
    MUGGLE_PR_WATCH_POLL_INTERVAL: String(interval),
  };
  const startedAt = Date.now();
  const stdout = execFileSync(
    "bash",
    [armPath, "--slot", toBash(slot), "--repo", "o/n", "--pr", "1", "--base", "master"],
    { env: env, encoding: "utf8", timeout: 60_000 },
  );
  return { stdout: stdout, seconds: (Date.now() - startedAt) / 1000 };
}

describe.skipIf(!hasBash)("pr-watch-loop.sh monitor window", () => {
  // The defect this closes: a loop that outlived its Monitor kept polling into a
  // closed pipe while its lease and heartbeat read healthy. Ending the loop with
  // its window hands the watch back to the session to re-arm.
  it("announces a rollover and exits once its window elapses", () => {
    expect(runWatch(2, 1).stdout).toMatch(/^ROLLOVER pr=1 /m);
  }, 60_000);

  // An interval far longer than the window stands in for a long fetch backoff:
  // the loop must wake at the window's end, not sleep past its monitor. The
  // interval is set so an unclamped sleep could not finish inside the bound
  // however fast the machine, while process spawns under a loaded parallel run
  // can take tens of seconds.
  it("does not sleep past its window", () => {
    expect(runWatch(2, 600).seconds).toBeLessThan(50);
  }, 60_000);

  // Every stdout line wakes the session, so a quiet window may add exactly one
  // line: the rollover itself.
  it("stays silent through quiet iterations", () => {
    const loopLines = runWatch(3, 1)
      .stdout.split("\n")
      .filter((line) => line.trim() && !/^(DRAIN|ARMED) /.test(line));
    expect(loopLines).toHaveLength(1);
    expect(loopLines[0]).toMatch(/^ROLLOVER /);
  }, 60_000);
});

// Runs one watch script against a merged PR and returns the command it was run
// as alongside what it printed — the two halves the post-merge guardrail reads.
function runAgainstMergedPr(script: string): { command: string; stdout: string } {
  const slot = mkdtempSync(join(tmpdir(), "pr-watch-slot-"));
  // The loop waits for arming to seed this before it polls at all.
  writeFileSync(
    join(slot, "watch-watermark.env"),
    'REV=0\nCOM=0\nTHREADS=""\nCIRED=""\nREBASED=""\nBLOCKED_CIDIGEST=""\n',
  );
  const args = [script, "--slot", toBash(slot), "--repo", "o/n", "--pr", "7", "--base", "master"];
  const stdout = execFileSync("bash", args, {
    env: { ...process.env, PATH: `${stubGhDir("MERGED")}${delimiter}${process.env.PATH ?? ""}` },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { command: `bash ${args.join(" ")}`, stdout: stdout };
}

// The post-merge guardrail recognises the terminal line by pattern, so it has to
// be checked against what the scripts really print. It drifted once already: the
// pattern kept the generated watch.sh's form after the loop moved into a file and
// changed it, and every test went on feeding the old form.
describe.skipIf(!hasBash)("terminal line contract with the post-merge guardrail", () => {
  it("recognises the line the arm script prints for an already-merged PR", () => {
    const { command, stdout } = runAgainstMergedPr(armPath);
    expect(detectPrTerminal({ tool_name: "Bash", tool_input: { command: command }, tool_response: { stdout: stdout } }))
      .toEqual({ prNumber: 7, verdict: PrTerminalVerdict.Merged });
  }, 60_000);

  it("recognises the line the loop prints when the PR merges", () => {
    const { command, stdout } = runAgainstMergedPr(loopPath);
    expect(detectPrTerminal({ tool_name: "Bash", tool_input: { command: command }, tool_response: { stdout: stdout } }))
      .toEqual({ prNumber: 7, verdict: PrTerminalVerdict.Merged });
  }, 60_000);
});

interface BaseMovementFixture {
  /** The base commit GitHub recorded at the PR's last head push. */
  baseRefOid: string;
  /** Where the base branch points now. */
  baseTipOid: string;
  behindBy: number;
}

// Unlike stubGhDir, this answers the state query by running the projection the
// caller passed through `--jq` over a raw GraphQL snapshot, so the base half of
// the rebase key comes out of the real fetch and filter rather than a canned line.
function stubGhFromSnapshot(fixture: BaseMovementFixture): string {
  const dir = mkdtempSync(join(tmpdir(), "pr-watch-gh-"));
  const snapshotPath = join(dir, "pr.json");
  writeFileSync(
    snapshotPath,
    JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            state: "OPEN",
            headRefOid: "HEAD1",
            baseRefOid: fixture.baseRefOid,
            baseRef: { target: { oid: fixture.baseTipOid } },
            mergeable: "MERGEABLE",
            commits: { nodes: [] },
            reviews: { nodes: [] },
            reviewThreads: { nodes: [] },
          },
        },
      },
    }),
  );
  const gh = join(dir, "gh");
  writeFileSync(
    gh,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "auth" ]; then echo stub-token; exit 0; fi',
      'if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then',
      '  while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && projection="$2"; shift; done',
      // jq on Windows ends lines with CRLF; gh's built-in filter does not.
      `  jq -r "$projection" "${toBash(snapshotPath)}" | tr -d '\\r'`,
      "  exit 0",
      "fi",
      `echo ${fixture.behindBy}`,
      "",
    ].join("\n"),
  );
  chmodSync(gh, 0o755);
  return dir;
}

function armAgainstBaseMovement(fixture: BaseMovementFixture): string {
  const slot = mkdtempSync(join(tmpdir(), "pr-watch-slot-"));
  execFileSync(
    "bash",
    [armPath, "--slot", toBash(slot), "--repo", "o/n", "--pr", "1", "--base", "master", "--no-exec"],
    {
      env: { ...process.env, PATH: `${stubGhFromSnapshot(fixture)}${delimiter}${process.env.PATH ?? ""}` },
      stdio: "ignore",
    },
  );
  return slot;
}

// Runs the loop for a few iterations over a slot whose rebase floor is
// `rebasedFloor`, returning only the EVENT lines it printed.
function watchAgainstBaseMovement(fixture: BaseMovementFixture, rebasedFloor: string): string[] {
  const slot = mkdtempSync(join(tmpdir(), "pr-watch-slot-"));
  writeFileSync(
    join(slot, "watch-watermark.env"),
    `REV=0\nCOM=0\nTHREADS=""\nCIRED=""\nREBASED="${rebasedFloor}"\nBLOCKED_CIDIGEST=""\n`,
  );
  const stdout = execFileSync(
    "bash",
    [loopPath, "--slot", toBash(slot), "--repo", "o/n", "--pr", "1", "--base", "master"],
    {
      env: {
        ...process.env,
        PATH: `${stubGhFromSnapshot(fixture)}${delimiter}${process.env.PATH ?? ""}`,
        MUGGLE_PR_WATCH_MONITOR_WINDOW: "3",
        MUGGLE_PR_WATCH_POLL_INTERVAL: "1",
      },
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  return stdout.split("\n").filter((line) => line.startsWith("EVENT "));
}

// GitHub advances baseRefOid only when the head is pushed, never when the base
// branch moves. A key built from it stays equal to an escalated or floored key
// however far the base advances, so a blocked branch never wakes again.
describe.skipIf(!hasBash || !hasJq)("rebase key tracks the base branch tip", () => {
  const staleRecordedBase: BaseMovementFixture = { baseRefOid: "BASEOLD", baseTipOid: "BASENEW", behindBy: 3 };

  it("wakes once when the base tip moves under an unchanged head and a stale baseRefOid", () => {
    const events = watchAgainstBaseMovement(staleRecordedBase, "HEAD1..BASEOLD");
    expect(events).toHaveLength(1);
    expect(events[0]).toContain("rebase due key=HEAD1..BASENEW");
  }, 60_000);

  it("stays quiet while neither the head nor the base tip has moved", () => {
    expect(watchAgainstBaseMovement(staleRecordedBase, "HEAD1..BASENEW")).toEqual([]);
  }, 60_000);

  it("seeds the rebase floor from the base tip", () => {
    const watermark = readFileSync(join(armAgainstBaseMovement(staleRecordedBase), "watch-watermark.env"), "utf8");
    expect(watermark).toContain('REBASED="HEAD1..BASENEW"');
  }, 60_000);
});

// Spaces, parens, colons and commas: every separator the real projection emits.
const blockedDigest = "agent-gate-eval:SUCCESS,codex-compat (macos-latest):FAILURE,node-compat (22):CANCELLED";
const rerunDigest = "agent-gate-eval:SUCCESS,codex-compat (macos-latest):SUCCESS,node-compat (22):CANCELLED";

// One last_seen.json entry, blocked on `ciDigest`, in the slot schema's shape.
function blockedEntry(ciDigest: string): object {
  return {
    lastBodyReviewId: 0,
    blocked: {
      reason: "ci_escalated",
      since: "2026-01-01T00:00:00Z",
      fingerprint: { head_sha: "HEAD1", latest_review_id: 0, ci_digest: ciDigest },
    },
  };
}

// Arms PR o/n#1 over a slot holding `lastSeen` as its last_seen.json (none when
// undefined) while the live checks read `liveDigest`. With `watch` the loop then
// runs out a 3s window. Throws if arming fails.
function armOverLastSeen(
  lastSeen: string | undefined,
  liveDigest: string,
  watch: boolean,
): { watermarkLines: string[]; stdout: string } {
  const slot = mkdtempSync(join(tmpdir(), "pr-watch-slot-"));
  if (lastSeen !== undefined) writeFileSync(join(slot, "last_seen.json"), lastSeen);
  const args = [armPath, "--slot", toBash(slot), "--repo", "o/n", "--pr", "1", "--base", "master"];
  const stdout = execFileSync("bash", watch ? args : [...args, "--no-exec"], {
    env: {
      ...process.env,
      PATH: `${stubGhDir("OPEN", liveDigest)}${delimiter}${process.env.PATH ?? ""}`,
      MUGGLE_PR_WATCH_MONITOR_WINDOW: "3",
      MUGGLE_PR_WATCH_POLL_INTERVAL: "1",
    },
    encoding: "utf8",
    timeout: 60_000,
  });
  return {
    watermarkLines: readFileSync(join(slot, "watch-watermark.env"), "utf8").split("\n"),
    stdout: stdout,
  };
}

const eventLines = (stdout: string) => stdout.split("\n").filter((line) => line.startsWith("EVENT "));

// Re-arming happens every monitor window, blocked or not. Seeding the floor
// empty on a blocked slot disarmed the resume probe at the first rollover, and
// the watch then slept through the CI rerun the block was waiting on.
describe.skipIf(!hasBash)("pr-watch-arm.sh blocked-resume floor", () => {
  it("seeds the floor from the blocked fingerprint's ci digest", () => {
    const { watermarkLines } = armOverLastSeen(JSON.stringify({ "o/n#1": blockedEntry(blockedDigest) }), blockedDigest, false);
    expect(watermarkLines).toContain(`BLOCKED_CIDIGEST="${blockedDigest}"`);
  }, 60_000);

  // Any byte lost between the write and the loop's read would read as a digest
  // move and wake a block whose CI never changed.
  it("reads back unchanged, so a blocked watch stays quiet while its CI holds", () => {
    expect(eventLines(armOverLastSeen(JSON.stringify({ "o/n#1": blockedEntry(blockedDigest) }), blockedDigest, true).stdout))
      .toEqual([]);
  }, 60_000);

  it("wakes a re-armed blocked watch when a CI rerun moves the digest", () => {
    const events = eventLines(armOverLastSeen(JSON.stringify({ "o/n#1": blockedEntry(blockedDigest) }), rerunDigest, true).stdout);
    expect(events).toHaveLength(1);
    expect(events[0]).toContain("ci digest moved while blocked");
  }, 60_000);

  // Another PR's block in the same file is not this PR's.
  it("leaves the floor empty for an unblocked PR", () => {
    const lastSeen = JSON.stringify({ "o/n#1": { lastBodyReviewId: 0 }, "o/n#2": blockedEntry(blockedDigest) });
    expect(armOverLastSeen(lastSeen, blockedDigest, false).watermarkLines).toContain('BLOCKED_CIDIGEST=""');
  }, 60_000);

  it("arms with an empty floor when last_seen.json is missing", () => {
    expect(armOverLastSeen(undefined, blockedDigest, false).watermarkLines).toContain('BLOCKED_CIDIGEST=""');
  }, 60_000);

  // Truncated mid-write, yet still holding a complete `"ci_digest": "..."` pair
  // a pattern match would take.
  it("arms with an empty floor when last_seen.json is malformed", () => {
    const truncated = JSON.stringify({ "o/n#1": blockedEntry(blockedDigest) }).slice(0, -1);
    const { watermarkLines, stdout } = armOverLastSeen(truncated, blockedDigest, false);
    expect(watermarkLines).toContain('BLOCKED_CIDIGEST=""');
    expect(stdout).toMatch(/^ARMED pr=1 /m);
  }, 60_000);

  // The watermark is line-based and the last match wins, so a digest carrying a
  // newline would forge whatever floor follows it.
  it("drops a digest spanning lines rather than letting it forge a floor", () => {
    const { watermarkLines } = armOverLastSeen(JSON.stringify({ "o/n#1": blockedEntry("x\nREV=999999") }), "", false);
    expect(watermarkLines).toContain('BLOCKED_CIDIGEST=""');
    expect(watermarkLines.filter((line) => line.startsWith("REV="))).toEqual(["REV=0"]);
  }, 60_000);

  // Check names come from the PR's own workflow files, so the digest is
  // author-controlled text and must never be evaluated on either side.
  it("carries shell syntax in a digest as inert text", () => {
    const marker = toBash(join(mkdtempSync(join(tmpdir(), "pr-watch-marker-")), "evaluated"));
    const hostileDigest = `deploy $(touch ${marker}) \`touch ${marker}\` "quoted":SUCCESS`;
    const { watermarkLines, stdout } = armOverLastSeen(
      JSON.stringify({ "o/n#1": blockedEntry(hostileDigest) }),
      hostileDigest,
      true,
    );
    expect(watermarkLines).toContain(`BLOCKED_CIDIGEST="${hostileDigest}"`);
    expect(eventLines(stdout)).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  }, 60_000);
});
