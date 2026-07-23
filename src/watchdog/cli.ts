import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  MAX_TICK_SPAWNS_PER_SCAN,
  PENDING_SIGNAL_CONFIRM_AFTER_MS,
  SPAWN_RETRY_AFTER_MS,
  WATCHDOG_HEARTBEAT_FILENAME,
  WATCHDOG_LOCK_FILENAME,
  WATCHDOG_LOG_FILENAME,
  WATCHDOG_SCAN_INTERVAL_SECONDS_DEFAULT,
  WATCHDOG_SLOT_STATE_FILENAME,
  WATCH_HEARTBEAT_FILENAME,
} from "./constants.js";
import { decideSlotAction, emptyWatchdogSlotState } from "./decide.js";
import { isCycleInProgress, newestFollowupLogTimestampMs } from "./followupLog.js";
import {
  isGitlabMrConflicting,
  mapGitlabDiscussionsToThreadSnapshots,
  mapGitlabMrStateToPrState,
  mapGitlabPipelineStatusToCiBucket,
} from "./gitlabSnapshot.js";
import { isWatcherLive } from "./liveness.js";
import { locateGitlabMrProject, locatePrRepo } from "./prLocator.js";
import {
  computeSlotSignature,
  selectActionableBodyReviewIds,
  selectActionableThreadIds,
} from "./signature.js";
import {
  CiRollupBucket,
  GitlabDiscussion,
  ReviewThreadSnapshot,
  SlotPollSnapshot,
  SlotWatchAction,
  SpawnTickReason,
  SubmittedReviewSnapshot,
  WatchdogSlotState,
} from "./types.js";

const muggleDoDir =
  process.env.MUGGLE_WATCHDOG_MUGGLE_DO_DIR ?? join(homedir(), ".muggle-ai", "muggle-do");
const sessionsDir = join(muggleDoDir, "sessions");
const lockFile = join(muggleDoDir, WATCHDOG_LOCK_FILENAME);
const heartbeatFile = join(muggleDoDir, WATCHDOG_HEARTBEAT_FILENAME);
const logFile = join(muggleDoDir, WATCHDOG_LOG_FILENAME);

const scanIntervalMs =
  Number(process.env.MUGGLE_WATCHDOG_INTERVAL_SECONDS ?? WATCHDOG_SCAN_INTERVAL_SECONDS_DEFAULT) *
  1000;

const SLOT_SLUG_PATTERN = /^[A-Za-z0-9._-]+$/;
const LOG_ROTATE_AT_BYTES = 512 * 1024;
const LOG_KEEP_TAIL_BYTES = 64 * 1024;

function log(message: string): void {
  mkdirSync(muggleDoDir, { recursive: true });
  try {
    if (existsSync(logFile) && statSync(logFile).size > LOG_ROTATE_AT_BYTES) {
      const tail = readFileSync(logFile, "utf-8").slice(-LOG_KEEP_TAIL_BYTES);
      writeFileSync(logFile, tail);
    }
  } catch {
    /* rotation is best-effort */
  }
  appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
}

function mtimeMsOrNull(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function readTextOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function readJsonOrNull<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

interface SlotPrRecord {
  repo: string;
  provider?: string;
  number: number;
  url: string;
  state: string;
}

interface OpenSlot {
  slug: string;
  slotDir: string;
  prRecord: SlotPrRecord;
}

function listOpenSlots(): OpenSlot[] {
  if (!existsSync(sessionsDir)) return [];
  const openSlots: OpenSlot[] = [];
  for (const slug of readdirSync(sessionsDir)) {
    const slotDir = join(sessionsDir, slug);
    // A ".stopped" suffix is the user's neutralize-this-watcher convention —
    // recovery must never resurrect it.
    if (slug.endsWith(".stopped")) continue;
    if (!existsSync(join(slotDir, "prs.json"))) continue;
    if (existsSync(join(slotDir, "result.md"))) continue;
    const prRecords = readJsonOrNull<SlotPrRecord[]>(join(slotDir, "prs.json"));
    const prRecord = prRecords?.[0];
    if (!prRecord || typeof prRecord.number !== "number") continue;
    if (!SLOT_SLUG_PATTERN.test(slug)) {
      log(`skip slot with unusable slug: ${JSON.stringify(slug)}`);
      continue;
    }
    if (!["github", "gitlab"].includes(prRecord.provider ?? "github")) {
      log(`skip slot ${slug}: provider ${prRecord.provider} not supported by the watchdog`);
      continue;
    }
    openSlots.push({ slug: slug, slotDir: slotDir, prRecord: prRecord });
  }
  return openSlots;
}

function providerCli(command: "gh" | "glab", args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    windowsHide: true,
    timeout: 60_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args[0]} exited ${result.status}: ${(result.stderr ?? "").slice(0, 400)}`,
    );
  }
  return result.stdout;
}

function gh(args: string[]): string {
  return providerCli("gh", args);
}

function glab(args: string[]): string {
  return providerCli("glab", args);
}

const PR_SNAPSHOT_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state
      headRefOid
      mergeable
      baseRefName
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      reviews(last: 30) { nodes { databaseId state comments { totalCount } } }
      reviewThreads(first: 100) {
        nodes { id isResolved isOutdated comments(last: 1) { nodes { body } } }
      }
    }
  }
}`;

interface LastSeenPrEntry {
  lastBodyReviewId?: number;
  escalated_review_ids?: number[];
}

function ciBucketFromRollupState(rollupState: string | null): CiRollupBucket {
  if (rollupState === "FAILURE" || rollupState === "ERROR") return CiRollupBucket.Fail;
  if (rollupState === "PENDING" || rollupState === "EXPECTED") return CiRollupBucket.Pending;
  if (rollupState === "SUCCESS") return CiRollupBucket.Pass;
  return CiRollupBucket.None;
}

function pollGithubPrSnapshot(slot: OpenSlot): SlotPollSnapshot {
  const repoLocator = locatePrRepo(slot.prRecord);
  if (!repoLocator) throw new Error(`cannot resolve owner/repo for slot ${slot.slug}`);
  const raw = gh([
    "api",
    "graphql",
    "-F",
    `owner=${repoLocator.owner}`,
    "-F",
    `name=${repoLocator.name}`,
    "-F",
    `number=${slot.prRecord.number}`,
    "-f",
    `query=${PR_SNAPSHOT_QUERY}`,
  ]);
  interface PrSnapshotQueryResult {
    data?: {
      repository?: {
        pullRequest?: {
          state: string;
          headRefOid: string;
          mergeable: string;
          baseRefName: string;
          commits: { nodes: Array<{ commit: { statusCheckRollup: { state: string } | null } }> };
          reviews: {
            nodes: Array<{ databaseId: number; state: string; comments: { totalCount: number } }>;
          };
          reviewThreads: {
            nodes: Array<{
              id: string;
              isResolved: boolean;
              isOutdated: boolean;
              comments: { nodes: Array<{ body: string }> };
            }>;
          };
        };
      };
    };
  }
  const pullRequest = (JSON.parse(raw) as PrSnapshotQueryResult).data?.repository?.pullRequest;
  if (!pullRequest) throw new Error(`no pullRequest in GraphQL response for ${slot.prRecord.url}`);

  const threads: ReviewThreadSnapshot[] = pullRequest.reviewThreads.nodes.map((node) => ({
    threadId: node.id,
    isResolved: node.isResolved,
    isOutdated: node.isOutdated,
    newestCommentBody: node.comments.nodes[node.comments.nodes.length - 1]?.body ?? "",
  }));
  const reviews: SubmittedReviewSnapshot[] = pullRequest.reviews.nodes.map((node) => ({
    reviewId: node.databaseId,
    reviewState: node.state,
    lineCommentCount: node.comments.totalCount,
  }));

  const lastSeenByPr = readJsonOrNull<Record<string, LastSeenPrEntry>>(
    join(slot.slotDir, "last_seen.json"),
  );
  const lastSeenEntry = lastSeenByPr?.[`${slot.prRecord.repo}#${slot.prRecord.number}`] ?? {};

  let behindBy = 0;
  if (pullRequest.state === "OPEN") {
    // Commit-ancestry compare, never mergeStateStatus==BEHIND — see
    // _shared/vcs/github/pr-metadata.md for why BEHIND is masked.
    const compareRaw = gh([
      "api",
      `repos/${repoLocator.owner}/${repoLocator.name}/compare/${pullRequest.baseRefName}...${pullRequest.headRefOid}`,
      "--jq",
      ".behind_by",
    ]);
    behindBy = Number(compareRaw.trim()) || 0;
  }

  return {
    prState: pullRequest.state,
    headSha: pullRequest.headRefOid,
    actionableThreadIds: selectActionableThreadIds(threads),
    actionableBodyReviewIds: selectActionableBodyReviewIds({
      reviews: reviews,
      lastBodyReviewId: lastSeenEntry.lastBodyReviewId ?? 0,
      escalatedReviewIds: lastSeenEntry.escalated_review_ids ?? [],
    }),
    behindBy: behindBy,
    isConflicting: pullRequest.mergeable === "CONFLICTING",
    ciBucket: ciBucketFromRollupState(
      pullRequest.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
    ),
  };
}

function pollGitlabMrSnapshot(slot: OpenSlot): SlotPollSnapshot {
  const mrLocator = locateGitlabMrProject(slot.prRecord);
  if (!mrLocator) throw new Error(`cannot resolve GitLab project for slot ${slot.slug}`);
  const hostArgs = ["--hostname", mrLocator.host];
  const mrApiPath = `projects/${encodeURIComponent(mrLocator.projectPath)}/merge_requests/${slot.prRecord.number}`;

  interface GitlabMrResponse {
    state: string;
    sha: string;
    target_branch: string;
    detailed_merge_status?: string;
  }
  const mergeRequest = JSON.parse(glab(["api", ...hostArgs, mrApiPath])) as GitlabMrResponse;
  const prState = mapGitlabMrStateToPrState(mergeRequest.state);

  const discussions = JSON.parse(
    glab(["api", ...hostArgs, `${mrApiPath}/discussions?per_page=100`]),
  ) as GitlabDiscussion[];

  let behindBy = 0;
  if (prState === "OPEN") {
    // Compare from=head to=target: GitLab lists only the commits `to` is ahead
    // by, so this direction yields the base commits the head lacks — see
    // _shared/vcs/gitlab/mr-metadata.md for why detailed_merge_status can't
    // report a behind branch.
    const compareApiPath =
      `projects/${encodeURIComponent(mrLocator.projectPath)}/repository/compare` +
      `?from=${mergeRequest.sha}&to=${encodeURIComponent(mergeRequest.target_branch)}`;
    const compareResponse = JSON.parse(glab(["api", ...hostArgs, compareApiPath])) as {
      commits?: unknown[];
    };
    behindBy = compareResponse.commits?.length ?? 0;
  }

  const pipelines = JSON.parse(
    glab(["api", ...hostArgs, `${mrApiPath}/pipelines?per_page=1`]),
  ) as Array<{ status?: string }>;

  return {
    prState: prState,
    headSha: mergeRequest.sha,
    actionableThreadIds: selectActionableThreadIds(
      mapGitlabDiscussionsToThreadSnapshots(discussions),
    ),
    // GitLab has no review envelope — feedback is always a discussion
    // (contract.md Step 3b is GitHub-only), so there is no body-only source.
    actionableBodyReviewIds: [],
    behindBy: behindBy,
    isConflicting: isGitlabMrConflicting(mergeRequest.detailed_merge_status ?? ""),
    ciBucket: mapGitlabPipelineStatusToCiBucket(pipelines[0]?.status ?? null),
  };
}

function pollSlotPrSnapshot(slot: OpenSlot): SlotPollSnapshot {
  return (slot.prRecord.provider ?? "github") === "gitlab"
    ? pollGitlabMrSnapshot(slot)
    : pollGithubPrSnapshot(slot);
}

function spawnHeadlessTick(slot: OpenSlot, spawnReason: SpawnTickReason): void {
  const claudeCommand = process.env.MUGGLE_WATCHDOG_CLAUDE_CMD ?? "claude";
  const claudeArgs =
    process.env.MUGGLE_WATCHDOG_CLAUDE_ARGS ??
    "--permission-mode acceptEdits --allowedTools Bash Read Write Edit Glob Grep Skill";
  const tickPrompt = `/muggle:muggle-pr-followup ${slot.slug} ${slot.prRecord.number}`;
  const command = `${claudeCommand} ${claudeArgs} -p "${tickPrompt}"`;

  // Never write the slot's followup.log here: a line there is the tick's
  // proof-of-run (spawn confirmation) and a liveness beacon for reconcile —
  // a spawn marker would self-confirm every spawn and fake a live watcher.
  log(`spawn tick slug=${slot.slug} pr=${slot.prRecord.number} reason=${spawnReason}`);

  const child = spawn(command, {
    shell: true,
    detached: true,
    stdio: "ignore",
    cwd: homedir(),
    windowsHide: true,
  });
  child.on("error", (error) => log(`spawn failed slug=${slot.slug}: ${String(error)}`));
  child.unref();
}

interface SpawnCandidate {
  slot: OpenSlot;
  spawnReason: SpawnTickReason;
  updatedSlotState: WatchdogSlotState;
}

function scanOnce(nowMs: number): { openSlotCount: number; spawnedCount: number } {
  const openSlots = listOpenSlots();
  const spawnCandidates: SpawnCandidate[] = [];

  for (const slot of openSlots) {
    try {
      const followupLogText = readTextOrEmpty(join(slot.slotDir, "followup.log"));
      const newestLogMs = newestFollowupLogTimestampMs(followupLogText);
      const watcherLive = isWatcherLive({
        heartbeatMtimeMs: mtimeMsOrNull(join(slot.slotDir, WATCH_HEARTBEAT_FILENAME)),
        newestFollowupLogTimestampMs: newestLogMs,
        nowMs: nowMs,
      });
      const cycleInProgress =
        !watcherLive && isCycleInProgress({ logText: followupLogText, nowMs: nowMs });
      // Only a dead, out-of-cycle slot is worth the provider API calls.
      if (watcherLive || cycleInProgress) continue;

      const pollSnapshot = pollSlotPrSnapshot(slot);
      const slotStateFile = join(slot.slotDir, WATCHDOG_SLOT_STATE_FILENAME);
      const decision = decideSlotAction({
        isWatcherLive: false,
        isCycleInProgress: false,
        pollSnapshot: pollSnapshot,
        signature: computeSlotSignature(pollSnapshot),
        storedSlotState: readJsonOrNull<WatchdogSlotState>(slotStateFile) ?? emptyWatchdogSlotState(),
        newestFollowupLogTimestampMs: newestLogMs,
        nowMs: nowMs,
        confirmSignalAfterMs: PENDING_SIGNAL_CONFIRM_AFTER_MS,
        spawnRetryAfterMs: SPAWN_RETRY_AFTER_MS,
      });

      if (decision.action === SlotWatchAction.SpawnTick) {
        spawnCandidates.push({
          slot: slot,
          spawnReason: decision.spawnReason ?? SpawnTickReason.ConfirmedSignal,
          updatedSlotState: decision.updatedSlotState!,
        });
      } else if (decision.updatedSlotState) {
        writeFileSync(slotStateFile, JSON.stringify(decision.updatedSlotState, null, 2));
      }
    } catch (error) {
      log(`slot ${slot.slug}: ${String(error)}`);
    }
  }

  // Terminal finalizes first — they are cheap and unblock cleanup. Deferred
  // candidates keep their pending state and spawn on a later scan.
  spawnCandidates.sort((a, b) =>
    a.spawnReason === b.spawnReason ? 0 : a.spawnReason === SpawnTickReason.TerminalPr ? -1 : 1,
  );
  const spawningNow = spawnCandidates.slice(0, MAX_TICK_SPAWNS_PER_SCAN);
  for (const candidate of spawningNow) {
    writeFileSync(
      join(candidate.slot.slotDir, WATCHDOG_SLOT_STATE_FILENAME),
      JSON.stringify(candidate.updatedSlotState, null, 2),
    );
    spawnHeadlessTick(candidate.slot, candidate.spawnReason);
  }

  return { openSlotCount: openSlots.length, spawnedCount: spawningNow.length };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface WatchdogLock {
  pid: number;
  started_at: string;
}

function liveLockPid(): number | null {
  const lock = readJsonOrNull<WatchdogLock>(lockFile);
  if (!lock || typeof lock.pid !== "number") return null;
  if (!isProcessAlive(lock.pid)) return null;
  const heartbeatMtimeMs = mtimeMsOrNull(heartbeatFile);
  if (heartbeatMtimeMs === null || Date.now() - heartbeatMtimeMs > 3 * scanIntervalMs) return null;
  return lock.pid;
}

function ensureDaemon(): void {
  if (liveLockPid() !== null) return;
  mkdirSync(muggleDoDir, { recursive: true });
  const logFd = openSync(logFile, "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "run"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  child.unref();
  log(`ensure: spawned watchdog daemon pid=${child.pid}`);
}

async function runDaemon(): Promise<void> {
  const otherPid = liveLockPid();
  if (otherPid !== null && otherPid !== process.pid) {
    log(`run: daemon already live (pid=${otherPid}); exiting`);
    return;
  }
  mkdirSync(muggleDoDir, { recursive: true });
  const lock: WatchdogLock = { pid: process.pid, started_at: new Date().toISOString() };
  writeFileSync(lockFile, JSON.stringify(lock, null, 2));
  log(`run: watchdog daemon started pid=${process.pid} intervalMs=${scanIntervalMs}`);
  try {
    for (;;) {
      writeFileSync(heartbeatFile, new Date().toISOString());
      let openSlotCount = 0;
      try {
        const scanResult = scanOnce(Date.now());
        openSlotCount = scanResult.openSlotCount;
      } catch (error) {
        log(`scan error: ${String(error)}`);
        openSlotCount = 1; // assume slots remain; a broken scan must not kill the daemon
      }
      if (openSlotCount === 0) {
        log("run: no open slots remain; exiting");
        return;
      }
      await sleep(scanIntervalMs);
    }
  } finally {
    rmSync(lockFile, { force: true });
  }
}

const subcommand = process.argv[2];
if (subcommand === "ensure") {
  ensureDaemon();
} else if (subcommand === "run") {
  await runDaemon();
} else if (subcommand === "scan-once") {
  const scanResult = scanOnce(Date.now());
  process.stdout.write(`${JSON.stringify(scanResult)}\n`);
} else {
  process.stderr.write("usage: pr-followup-watchdog.mjs <ensure|run|scan-once>\n");
  process.exitCode = 2;
}
