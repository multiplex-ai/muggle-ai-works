/**
 * Behavioural tests for plugin/skills/muggle-pr-followup/poll.sh.
 *
 * The poller's contract with the Monitor tool is that a quiet iteration prints
 * nothing — every stdout line costs a turn in the session that armed it. So the
 * assertions here are mostly about silence: a resolved thread, an outdated one,
 * a thread the loop already answered, and a review below the watermark must all
 * produce zero bytes. The positive controls exist so the silence assertions
 * cannot pass vacuously.
 *
 * `gh` is stubbed on PATH; nothing here touches the real GitHub API.
 */

import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Each case spawns bash, the poller, the gh stub and a handful of jq calls;
// process startup on Windows puts a realistic iteration past the 5s default.
vi.setConfig({ testTimeout: 60_000 });

const toBash = (p: string) => p.replace(/\\/g, "/");

const scriptPath = toBash(
  fileURLToPath(
    new URL("../../../plugin/skills/muggle-pr-followup/poll.sh", import.meta.url),
  ),
);

const SLUG = "repo-pr7";
const REPO = "acme/repo";
const NUMBER = 7;
const PR_KEY = `${REPO}#${NUMBER}`;
const BOT_MARKER = "<!-- muggle-do:bot -->";

let hasShellTooling = false;
try {
  execFileSync("bash", ["-c", "command -v jq"], { stdio: "ignore" });
  hasShellTooling = true;
} catch {
  // bash or jq unavailable — the suites below skip
}

// Dispatches on the shape of the gh invocation and replays a fixture file. The
// `comments` arm must precede the `reviews` arm — the line-comment URL contains
// the substring "reviews" too.
const GH_STUB = `#!/usr/bin/env bash
if [ -f "$GH_STUB_DIR/fail" ]; then exit 1; fi
fixture=""
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then fixture=pr-view.json; fi
if [ "$1" = "pr" ] && [ "$2" = "checks" ]; then fixture=checks.json; fi
if [ "$1" = "api" ]; then
  case "$*" in
    *graphql*) fixture=threads.json ;;
    *compare*) fixture=compare.json ;;
    */comments*) fixture=review-comments.json ;;
    *reviews*) fixture=reviews.json ;;
  esac
fi
[ -n "$fixture" ] || exit 1
[ -f "$GH_STUB_DIR/$fixture" ] || exit 1
cat "$GH_STUB_DIR/$fixture"
`;

// Node writes 0644 by default, which Git Bash will not put on PATH.
function writeStub(stubDir: string) {
  const stub = join(stubDir, "gh");
  writeFileSync(stub, GH_STUB);
  chmodSync(stub, 0o755);
}

// Git Bash skips a `C:/...` entry when resolving a command, so the stub dir has
// to reach PATH in POSIX form or the real gh wins. cygpath is absent on Linux,
// where the path is already POSIX.
const PREPEND_STUB_TO_PATH =
  'export PATH="$(cygpath -u "$STUB_DIR" 2>/dev/null || echo "$STUB_DIR"):$PATH"';
const RUN_POLL = `${PREPEND_STUB_TO_PATH}; bash "$SCRIPT" --slug "$SLUG" --repo "$REPO" --number "$NUMBER"`;

const OPEN_PR = {
  url: `https://github.com/${REPO}/pull/${NUMBER}`,
  number: NUMBER,
  headRefOid: "head1111111111111111111111111111111111111",
  headRefName: "feat/x",
  baseRefName: "master",
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
};

const NO_THREADS = {
  data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
};

const CURRENT_WITH_BASE = {
  behind_by: 0,
  base_commit: { sha: "base1111111111111111111111111111111111111" },
};

const GREEN_CHECKS = [{ name: "lint", state: "SUCCESS", bucket: "pass", link: "" }];

function thread(overrides: {
  isResolved?: boolean;
  isOutdated?: boolean;
  body?: string;
  reviewId?: number;
}) {
  return {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [
              {
                id: "T1",
                isResolved: overrides.isResolved ?? false,
                isOutdated: overrides.isOutdated ?? false,
                comments: {
                  nodes: [
                    {
                      databaseId: 1,
                      pullRequestReview: { databaseId: overrides.reviewId ?? 9001 },
                      author: { login: "reviewer" },
                      body: "please fix",
                      createdAt: "2026-07-01T00:00:00Z",
                    },
                    {
                      databaseId: 2,
                      pullRequestReview: { databaseId: overrides.reviewId ?? 9001 },
                      author: { login: "reviewer" },
                      body: overrides.body ?? "still wrong",
                      createdAt: "2026-07-02T00:00:00Z",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };
}

interface PollRun {
  stdout: string;
  lines: string[];
  status: number;
  slot: string;
}

function runPoll(options: {
  fixtures?: Record<string, unknown>;
  lastSeen?: Record<string, unknown>;
  fail?: boolean;
  iterations?: number;
}): PollRun {
  const root = mkdtempSync(join(tmpdir(), "poll-sh-"));
  const home = join(root, "home");
  const slot = join(home, ".muggle-ai", "muggle-do", "sessions", SLUG);
  const stubDir = join(root, "bin");
  mkdirSync(slot, { recursive: true });
  mkdirSync(stubDir, { recursive: true });

  writeStub(stubDir);
  writeFileSync(
    join(slot, "last_seen.json"),
    JSON.stringify({ [PR_KEY]: { idle_tick_count: 0, ...(options.lastSeen ?? {}) } }),
  );

  const fixtures: Record<string, unknown> = {
    "pr-view.json": OPEN_PR,
    "threads.json": NO_THREADS,
    "reviews.json": [],
    "review-comments.json": [],
    "compare.json": CURRENT_WITH_BASE,
    "checks.json": GREEN_CHECKS,
    ...(options.fixtures ?? {}),
  };
  for (const [name, body] of Object.entries(fixtures)) {
    writeFileSync(join(stubDir, name), JSON.stringify(body));
  }
  if (options.fail) writeFileSync(join(stubDir, "fail"), "");

  const command = RUN_POLL;
  const env = {
    ...process.env,
    HOME: toBash(home),
    STUB_DIR: toBash(stubDir),
    GH_STUB_DIR: toBash(stubDir),
    SCRIPT: scriptPath,
    SLUG,
    REPO,
    NUMBER: String(NUMBER),
    MUGGLE_POLL_TEST_INTERVAL_SECONDS: "0",
    MUGGLE_POLL_TEST_MAX_ITERATIONS: String(options.iterations ?? 1),
  };

  let stdout: string;
  let status = 0;
  try {
    stdout = execFileSync("bash", ["-c", command], { env, encoding: "utf-8" });
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer | string; status?: number };
    stdout = err.stdout?.toString() ?? "";
    status = err.status ?? 1;
  }
  return {
    stdout,
    lines: stdout.split("\n").filter((l) => l.trim().length > 0),
    status,
    slot,
  };
}

describe.skipIf(!hasShellTooling)("poll.sh — silence on a quiet PR", () => {
  it("emits nothing when there is no feedback, the branch is current, and CI is green", () => {
    expect(runPoll({}).stdout).toBe("");
  });

  it("emits nothing for a thread whose newest comment carries the loop marker", () => {
    const run = runPoll({
      fixtures: { "threads.json": thread({ body: `done in abc123\n${BOT_MARKER}` }) },
    });
    expect(run.stdout).toBe("");
  });

  it("emits nothing for a resolved thread", () => {
    expect(runPoll({ fixtures: { "threads.json": thread({ isResolved: true }) } }).stdout).toBe("");
  });

  it("emits nothing for an outdated thread", () => {
    expect(runPoll({ fixtures: { "threads.json": thread({ isOutdated: true }) } }).stdout).toBe("");
  });

  it("emits nothing for a review at or below the body-only watermark", () => {
    const run = runPoll({
      fixtures: {
        "reviews.json": [
          { id: 500, state: "COMMENTED", body: "looks off", submitted_at: "2026-07-01T00:00:00Z" },
        ],
      },
      lastSeen: { lastBodyReviewId: 500 },
    });
    expect(run.stdout).toBe("");
  });

  it("emits nothing for a review already escalated to the owner", () => {
    const run = runPoll({
      fixtures: {
        "reviews.json": [
          { id: 700, state: "COMMENTED", body: "ambiguous", submitted_at: "2026-07-01T00:00:00Z" },
        ],
      },
      lastSeen: { lastBodyReviewId: 100, escalated_review_ids: [700] },
    });
    expect(run.stdout).toBe("");
  });
});

describe.skipIf(!hasShellTooling)("poll.sh — actionable events", () => {
  it("emits exactly one REVIEWS line for a new body-only review", () => {
    const run = runPoll({
      fixtures: {
        "reviews.json": [
          { id: 500, state: "CHANGES_REQUESTED", body: "fix it", submitted_at: "2026-07-01T00:00:00Z" },
        ],
      },
      lastSeen: { lastBodyReviewId: 100 },
    });
    expect(run.lines).toEqual([`MUGGLE-WATCH ${SLUG} REVIEWS 500`]);
  });

  it("emits the owning review id for an actionable line-comment thread", () => {
    const run = runPoll({ fixtures: { "threads.json": thread({ reviewId: 4242 }) } });
    expect(run.lines).toEqual([`MUGGLE-WATCH ${SLUG} REVIEWS 4242`]);
  });

  it("does not repeat an unchanged actionable state on the next iteration", () => {
    const run = runPoll({
      fixtures: { "threads.json": thread({ reviewId: 4242 }) },
      iterations: 3,
    });
    expect(run.lines).toEqual([`MUGGLE-WATCH ${SLUG} REVIEWS 4242`]);
  });

  it("emits REBASE keyed on head..base-tip when the branch is behind", () => {
    const run = runPoll({
      fixtures: {
        "compare.json": { behind_by: 4, base_commit: { sha: "basetip" } },
      },
    });
    expect(run.lines).toEqual([`MUGGLE-WATCH ${SLUG} REBASE ${OPEN_PR.headRefOid}..basetip`]);
  });

  it("suppresses REBASE once the per-key attempt cap is spent", () => {
    const run = runPoll({
      fixtures: { "compare.json": { behind_by: 4, base_commit: { sha: "basetip" } } },
      lastSeen: { conflict_resolve_attempts: { [`${OPEN_PR.headRefOid}..basetip`]: 2 } },
    });
    expect(run.stdout).toBe("");
  });

  it("emits CI with the red check names when checks have settled", () => {
    const run = runPoll({
      fixtures: {
        "checks.json": [
          { name: "lint", state: "SUCCESS", bucket: "pass", link: "" },
          { name: "unit (node 22)", state: "FAILURE", bucket: "fail", link: "" },
        ],
      },
    });
    expect(run.lines).toEqual([`MUGGLE-WATCH ${SLUG} CI unit (node 22)`]);
  });

  it("stays silent while any check is still pending", () => {
    const run = runPoll({
      fixtures: {
        "checks.json": [
          { name: "unit", state: "FAILURE", bucket: "fail", link: "" },
          { name: "build", state: "PENDING", bucket: "pending", link: "" },
        ],
      },
    });
    expect(run.stdout).toBe("");
  });

  it("suppresses CI once the per-SHA fix budget is spent", () => {
    const run = runPoll({
      fixtures: {
        "checks.json": [{ name: "unit", state: "FAILURE", bucket: "fail", link: "" }],
      },
      lastSeen: { ci_fix_attempts: { [OPEN_PR.headRefOid]: 3 } },
    });
    expect(run.stdout).toBe("");
  });

  it("lets reviews preempt red CI in the same iteration", () => {
    const run = runPoll({
      fixtures: {
        "threads.json": thread({ reviewId: 4242 }),
        "checks.json": [{ name: "unit", state: "FAILURE", bucket: "fail", link: "" }],
      },
    });
    expect(run.lines).toEqual([`MUGGLE-WATCH ${SLUG} REVIEWS 4242`]);
  });
});

describe.skipIf(!hasShellTooling)("poll.sh — coverage of non-quiet silence", () => {
  it("emits TERMINAL merged and exits rather than polling on", () => {
    const run = runPoll({
      fixtures: { "pr-view.json": { ...OPEN_PR, state: "MERGED" } },
      iterations: 5,
    });
    expect(run.lines).toEqual([`MUGGLE-WATCH ${SLUG} TERMINAL merged`]);
    expect(run.status).toBe(0);
  });

  it("emits TERMINAL closed and exits", () => {
    const run = runPoll({
      fixtures: { "pr-view.json": { ...OPEN_PR, state: "CLOSED" } },
      iterations: 5,
    });
    expect(run.lines).toEqual([`MUGGLE-WATCH ${SLUG} TERMINAL closed`]);
  });

  it("emits ERROR on a gh failure and keeps polling", () => {
    const run = runPoll({ fail: true, iterations: 3 });
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toMatch(/^MUGGLE-WATCH repo-pr7 ERROR pr metadata fetch failed/);
    expect(run.status).toBe(0);
  });

  it("errors out when the session slot is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "poll-sh-noslot-"));
    let stdout: string;
    let status = 0;
    try {
      stdout = execFileSync("bash", ["-c", `bash "$SCRIPT" --slug x --repo a/b --number 1`], {
        env: { ...process.env, HOME: toBash(root), SCRIPT: scriptPath },
        encoding: "utf-8",
      });
    } catch (e: unknown) {
      const err = e as { stdout?: Buffer | string; status?: number };
      stdout = err.stdout?.toString() ?? "";
      status = err.status ?? 1;
    }
    expect(stdout).toMatch(/ERROR no session slot at/);
    expect(status).toBe(1);
  });
});

describe.skipIf(!hasShellTooling)("poll.sh — state writes", () => {
  it("leaves an ISO-8601 heartbeat in followup.log so reconcile sees a live watcher", () => {
    const run = runPoll({});
    const log = readFileSync(join(run.slot, "followup.log"), "utf-8");
    expect(log).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z poll pr=7 idle$/m);
  });

  it("advances idle_tick_count without dropping fields it does not own", () => {
    const root = mkdtempSync(join(tmpdir(), "poll-sh-state-"));
    const home = join(root, "home");
    const slot = join(home, ".muggle-ai", "muggle-do", "sessions", SLUG);
    const stubDir = join(root, "bin");
    mkdirSync(slot, { recursive: true });
    mkdirSync(stubDir, { recursive: true });
    writeStub(stubDir);
    for (const [name, body] of Object.entries({
      "pr-view.json": OPEN_PR,
      "threads.json": NO_THREADS,
      "reviews.json": [],
      "review-comments.json": [],
      "compare.json": CURRENT_WITH_BASE,
      "checks.json": GREEN_CHECKS,
    })) {
      writeFileSync(join(stubDir, name), JSON.stringify(body));
    }
    const lastSeenPath = join(slot, "last_seen.json");
    writeFileSync(
      lastSeenPath,
      JSON.stringify({
        [PR_KEY]: { idle_tick_count: 4, pushed_shas: ["deadbee"], cycles_completed: 2 },
        "other/repo#1": { idle_tick_count: 99 },
      }),
    );

    execFileSync(
      "bash",
      ["-c", RUN_POLL],
      {
        env: {
          ...process.env,
          HOME: toBash(home),
          STUB_DIR: toBash(stubDir),
          GH_STUB_DIR: toBash(stubDir),
          SCRIPT: scriptPath,
          SLUG,
          REPO,
          NUMBER: String(NUMBER),
          MUGGLE_POLL_TEST_INTERVAL_SECONDS: "0",
          MUGGLE_POLL_TEST_MAX_ITERATIONS: "1",
        },
        encoding: "utf-8",
      },
    );

    const written = JSON.parse(
      execFileSync("bash", ["-c", `cat "$F"`], {
        env: { ...process.env, F: toBash(lastSeenPath) },
        encoding: "utf-8",
      }),
    );
    expect(written[PR_KEY].idle_tick_count).toBe(5);
    expect(written[PR_KEY].pushed_shas).toEqual(["deadbee"]);
    expect(written[PR_KEY].cycles_completed).toBe(2);
    expect(written["other/repo#1"].idle_tick_count).toBe(99);
  });
});
