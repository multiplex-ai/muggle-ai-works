import { spawn as spawn$1, spawnSync } from 'child_process';
import { mkdirSync, openSync, writeFileSync, rmSync, existsSync, statSync, readFileSync, appendFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { setTimeout } from 'timers/promises';
import { fileURLToPath } from 'url';

// src/watchdog/cli.ts

// src/watchdog/constants.ts
var WATCHDOG_SCAN_INTERVAL_SECONDS_DEFAULT = 300;
var WATCHER_LIVENESS_STALE_AFTER_MS = 15 * 60 * 1e3;
var PENDING_SIGNAL_CONFIRM_AFTER_MS = 4 * 60 * 1e3;
var SPAWN_RETRY_AFTER_MS = 10 * 60 * 1e3;
var CYCLE_IN_PROGRESS_GRACE_MS = 90 * 60 * 1e3;
var MAX_TICK_SPAWNS_PER_SCAN = 3;
var LOOP_REPLY_MARKER = "<!-- muggle-do:bot -->";
var WATCH_HEARTBEAT_FILENAME = "watch-heartbeat";
var WATCHDOG_SLOT_STATE_FILENAME = "watchdog.json";
var WATCHDOG_LOCK_FILENAME = "watchdog.lock";
var WATCHDOG_HEARTBEAT_FILENAME = "watchdog-heartbeat";
var WATCHDOG_LOG_FILENAME = "watchdog.log";

// src/watchdog/signature.ts
var ACTIONABLE_BODY_REVIEW_STATES = /* @__PURE__ */ new Set(["CHANGES_REQUESTED", "COMMENTED"]);
function selectActionableThreadIds(threads, loopReplyMarker = LOOP_REPLY_MARKER) {
  return threads.filter(
    (thread) => !thread.isResolved && !thread.isOutdated && !thread.newestCommentBody.includes(loopReplyMarker)
  ).map((thread) => thread.threadId);
}
function selectActionableBodyReviewIds(args) {
  const escalatedReviewIdSet = new Set(args.escalatedReviewIds);
  return args.reviews.filter(
    (review) => ACTIONABLE_BODY_REVIEW_STATES.has(review.reviewState) && review.lineCommentCount === 0 && review.reviewId > args.lastBodyReviewId && !escalatedReviewIdSet.has(review.reviewId)
  ).map((review) => review.reviewId);
}
function hasSpawnSignal(pollSnapshot) {
  return pollSnapshot.prState !== "OPEN" || pollSnapshot.actionableThreadIds.length > 0 || pollSnapshot.actionableBodyReviewIds.length > 0 || pollSnapshot.behindBy > 0 || pollSnapshot.isConflicting || pollSnapshot.ciBucket === "fail";
}
function computeSlotSignature(pollSnapshot) {
  return JSON.stringify({
    prState: pollSnapshot.prState,
    headSha: pollSnapshot.headSha,
    actionableThreadIds: [...pollSnapshot.actionableThreadIds].sort(),
    actionableBodyReviewIds: [...pollSnapshot.actionableBodyReviewIds].sort((a, b) => a - b),
    behindBy: pollSnapshot.behindBy,
    isConflicting: pollSnapshot.isConflicting,
    ciBucket: pollSnapshot.ciBucket
  });
}

// src/watchdog/decide.ts
function emptyWatchdogSlotState() {
  return {
    pending_signature: null,
    pending_seen_at: null,
    last_spawn_signature: null,
    last_spawn_at: null,
    spawn_attempts: 0
  };
}
function skip(skipReason, updatedSlotState) {
  return { action: "skip" /* Skip */, skipReason, updatedSlotState };
}
function spawn(spawnReason, input) {
  const updatedSlotState = {
    pending_signature: null,
    pending_seen_at: null,
    last_spawn_signature: input.signature,
    last_spawn_at: new Date(input.nowMs).toISOString(),
    spawn_attempts: input.storedSlotState.spawn_attempts + 1
  };
  return { action: "spawn-tick" /* SpawnTick */, spawnReason, updatedSlotState };
}
function decideSlotAction(input) {
  const stored = input.storedSlotState;
  if (!hasSpawnSignal(input.pollSnapshot)) {
    if (stored.pending_signature === null) return skip("no-signal" /* NoSignal */);
    return skip("no-signal" /* NoSignal */, { ...stored, pending_signature: null, pending_seen_at: null });
  }
  if (stored.last_spawn_signature === input.signature && stored.last_spawn_at !== null) {
    const lastSpawnMs = Date.parse(stored.last_spawn_at);
    const tickRanAfterSpawn = input.pollSnapshot.prState === "OPEN" && input.newestFollowupLogTimestampMs !== null && input.newestFollowupLogTimestampMs > lastSpawnMs;
    if (tickRanAfterSpawn) return skip("already-handled" /* AlreadyHandled */);
    if (input.nowMs - lastSpawnMs < input.spawnRetryAfterMs) {
      return skip("awaiting-spawn-retry-window" /* AwaitingSpawnRetryWindow */);
    }
    return spawn("spawn-retry" /* SpawnRetry */, input);
  }
  if (input.pollSnapshot.prState !== "OPEN") return spawn("terminal-pr" /* TerminalPr */, input);
  if (stored.pending_signature !== input.signature || stored.pending_seen_at === null) {
    const updatedSlotState = {
      ...stored,
      pending_signature: input.signature,
      pending_seen_at: new Date(input.nowMs).toISOString()
    };
    return { action: "record-pending-signal" /* RecordPendingSignal */, updatedSlotState };
  }
  if (input.nowMs - Date.parse(stored.pending_seen_at) >= input.confirmSignalAfterMs) {
    return spawn("confirmed-signal" /* ConfirmedSignal */, input);
  }
  return skip("awaiting-signal-confirmation" /* AwaitingSignalConfirmation */);
}

// src/watchdog/followupLog.ts
var DISPATCH_LINE_PATTERN = /\bdispatch/i;
var CYCLE_OUTCOME_LINE_PATTERN = /\boutcome=/i;
function lineTimestampMs(line) {
  const firstToken = line.trimStart().split(/\s+/, 1)[0] ?? "";
  const parsed = Date.parse(firstToken);
  return Number.isNaN(parsed) ? null : parsed;
}
function newestFollowupLogTimestampMs(logText) {
  let newestMs = null;
  for (const line of logText.split("\n")) {
    const timestampMs = lineTimestampMs(line);
    if (timestampMs !== null && (newestMs === null || timestampMs > newestMs)) {
      newestMs = timestampMs;
    }
  }
  return newestMs;
}
function isCycleInProgress(args) {
  const graceMs = args.graceMs ?? CYCLE_IN_PROGRESS_GRACE_MS;
  let lastDispatchMs = null;
  let lastOutcomeMs = null;
  for (const line of args.logText.split("\n")) {
    const timestampMs = lineTimestampMs(line);
    if (timestampMs === null) continue;
    if (CYCLE_OUTCOME_LINE_PATTERN.test(line)) {
      if (lastOutcomeMs === null || timestampMs > lastOutcomeMs) lastOutcomeMs = timestampMs;
    } else if (DISPATCH_LINE_PATTERN.test(line)) {
      if (lastDispatchMs === null || timestampMs > lastDispatchMs) lastDispatchMs = timestampMs;
    }
  }
  if (lastDispatchMs === null) return false;
  if (lastOutcomeMs !== null && lastOutcomeMs >= lastDispatchMs) return false;
  return args.nowMs - lastDispatchMs < graceMs;
}

// src/watchdog/gitlabSnapshot.ts
var GITLAB_CONFLICTING_MERGE_STATUSES = /* @__PURE__ */ new Set(["broken_status", "conflict"]);
var GITLAB_GREEN_PIPELINE_STATUSES = /* @__PURE__ */ new Set(["success", "canceled", "skipped", "manual"]);
function mapGitlabMrStateToPrState(gitlabMrState) {
  if (gitlabMrState === "merged") return "MERGED";
  if (gitlabMrState === "closed") return "CLOSED";
  return "OPEN";
}
function isGitlabMrConflicting(detailedMergeStatus) {
  return GITLAB_CONFLICTING_MERGE_STATUSES.has(detailedMergeStatus);
}
function mapGitlabPipelineStatusToCiBucket(pipelineStatus) {
  if (pipelineStatus === null || pipelineStatus === "") return "none" /* None */;
  if (pipelineStatus === "failed") return "fail" /* Fail */;
  if (GITLAB_GREEN_PIPELINE_STATUSES.has(pipelineStatus)) return "pass" /* Pass */;
  return "pending" /* Pending */;
}
function mapGitlabDiscussionsToThreadSnapshots(discussions) {
  return discussions.map((discussion) => {
    const isResolvable = discussion.notes[0]?.resolvable === true;
    const isUnresolved = isResolvable && discussion.notes.some((note) => note.resolved === false);
    return {
      threadId: discussion.id,
      isResolved: !isUnresolved,
      isOutdated: false,
      newestCommentBody: discussion.notes[discussion.notes.length - 1]?.body ?? ""
    };
  });
}

// src/watchdog/liveness.ts
function isWatcherLive(args) {
  const staleAfterMs = args.staleAfterMs ?? WATCHER_LIVENESS_STALE_AFTER_MS;
  const newestBeaconMs = Math.max(
    args.heartbeatMtimeMs ?? Number.NEGATIVE_INFINITY,
    args.newestFollowupLogTimestampMs ?? Number.NEGATIVE_INFINITY
  );
  return args.nowMs - newestBeaconMs < staleAfterMs;
}

// src/watchdog/prLocator.ts
function locatePrRepo(prRecord) {
  const urlMatch = /github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(prRecord.url ?? "");
  if (urlMatch) return { owner: urlMatch[1], name: urlMatch[2] };
  const [owner, name] = (prRecord.repo ?? "").split("/");
  if (owner && name) return { owner, name };
  return null;
}
function locateGitlabMrProject(prRecord) {
  const urlMatch = /^https?:\/\/([^/]+)\/(.+)\/-\/merge_requests\/\d+/.exec(prRecord.url ?? "");
  if (!urlMatch) return null;
  return { host: urlMatch[1], projectPath: urlMatch[2] };
}

// src/watchdog/cli.ts
var muggleDoDir = process.env.MUGGLE_WATCHDOG_MUGGLE_DO_DIR ?? join(homedir(), ".muggle-ai", "muggle-do");
var sessionsDir = join(muggleDoDir, "sessions");
var lockFile = join(muggleDoDir, WATCHDOG_LOCK_FILENAME);
var heartbeatFile = join(muggleDoDir, WATCHDOG_HEARTBEAT_FILENAME);
var logFile = join(muggleDoDir, WATCHDOG_LOG_FILENAME);
var scanIntervalMs = Number(process.env.MUGGLE_WATCHDOG_INTERVAL_SECONDS ?? WATCHDOG_SCAN_INTERVAL_SECONDS_DEFAULT) * 1e3;
var SLOT_SLUG_PATTERN = /^[A-Za-z0-9._-]+$/;
var LOG_ROTATE_AT_BYTES = 512 * 1024;
var LOG_KEEP_TAIL_BYTES = 64 * 1024;
function log(message) {
  mkdirSync(muggleDoDir, { recursive: true });
  try {
    if (existsSync(logFile) && statSync(logFile).size > LOG_ROTATE_AT_BYTES) {
      const tail = readFileSync(logFile, "utf-8").slice(-LOG_KEEP_TAIL_BYTES);
      writeFileSync(logFile, tail);
    }
  } catch {
  }
  appendFileSync(logFile, `${(/* @__PURE__ */ new Date()).toISOString()} ${message}
`);
}
function mtimeMsOrNull(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}
function readTextOrEmpty(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}
function readJsonOrNull(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}
function listOpenSlots() {
  if (!existsSync(sessionsDir)) return [];
  const openSlots = [];
  for (const slug of readdirSync(sessionsDir)) {
    const slotDir = join(sessionsDir, slug);
    if (slug.endsWith(".stopped")) continue;
    if (!existsSync(join(slotDir, "prs.json"))) continue;
    if (existsSync(join(slotDir, "result.md"))) continue;
    const prRecords = readJsonOrNull(join(slotDir, "prs.json"));
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
    openSlots.push({ slug, slotDir, prRecord });
  }
  return openSlots;
}
function providerCli(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    windowsHide: true,
    timeout: 6e4
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args[0]} exited ${result.status}: ${(result.stderr ?? "").slice(0, 400)}`
    );
  }
  return result.stdout;
}
function gh(args) {
  return providerCli("gh", args);
}
function glab(args) {
  return providerCli("glab", args);
}
var PR_SNAPSHOT_QUERY = `
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
function ciBucketFromRollupState(rollupState) {
  if (rollupState === "FAILURE" || rollupState === "ERROR") return "fail" /* Fail */;
  if (rollupState === "PENDING" || rollupState === "EXPECTED") return "pending" /* Pending */;
  if (rollupState === "SUCCESS") return "pass" /* Pass */;
  return "none" /* None */;
}
function pollGithubPrSnapshot(slot) {
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
    `query=${PR_SNAPSHOT_QUERY}`
  ]);
  const pullRequest = JSON.parse(raw).data?.repository?.pullRequest;
  if (!pullRequest) throw new Error(`no pullRequest in GraphQL response for ${slot.prRecord.url}`);
  const threads = pullRequest.reviewThreads.nodes.map((node) => ({
    threadId: node.id,
    isResolved: node.isResolved,
    isOutdated: node.isOutdated,
    newestCommentBody: node.comments.nodes[node.comments.nodes.length - 1]?.body ?? ""
  }));
  const reviews = pullRequest.reviews.nodes.map((node) => ({
    reviewId: node.databaseId,
    reviewState: node.state,
    lineCommentCount: node.comments.totalCount
  }));
  const lastSeenByPr = readJsonOrNull(
    join(slot.slotDir, "last_seen.json")
  );
  const lastSeenEntry = lastSeenByPr?.[`${slot.prRecord.repo}#${slot.prRecord.number}`] ?? {};
  let behindBy = 0;
  if (pullRequest.state === "OPEN") {
    const compareRaw = gh([
      "api",
      `repos/${repoLocator.owner}/${repoLocator.name}/compare/${pullRequest.baseRefName}...${pullRequest.headRefOid}`,
      "--jq",
      ".behind_by"
    ]);
    behindBy = Number(compareRaw.trim()) || 0;
  }
  return {
    prState: pullRequest.state,
    headSha: pullRequest.headRefOid,
    actionableThreadIds: selectActionableThreadIds(threads),
    actionableBodyReviewIds: selectActionableBodyReviewIds({
      reviews,
      lastBodyReviewId: lastSeenEntry.lastBodyReviewId ?? 0,
      escalatedReviewIds: lastSeenEntry.escalated_review_ids ?? []
    }),
    behindBy,
    isConflicting: pullRequest.mergeable === "CONFLICTING",
    ciBucket: ciBucketFromRollupState(
      pullRequest.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null
    )
  };
}
function pollGitlabMrSnapshot(slot) {
  const mrLocator = locateGitlabMrProject(slot.prRecord);
  if (!mrLocator) throw new Error(`cannot resolve GitLab project for slot ${slot.slug}`);
  const hostArgs = ["--hostname", mrLocator.host];
  const mrApiPath = `projects/${encodeURIComponent(mrLocator.projectPath)}/merge_requests/${slot.prRecord.number}`;
  const mergeRequest = JSON.parse(glab(["api", ...hostArgs, mrApiPath]));
  const prState = mapGitlabMrStateToPrState(mergeRequest.state);
  const discussions = JSON.parse(
    glab(["api", ...hostArgs, `${mrApiPath}/discussions?per_page=100`])
  );
  let behindBy = 0;
  if (prState === "OPEN") {
    const compareApiPath = `projects/${encodeURIComponent(mrLocator.projectPath)}/repository/compare?from=${mergeRequest.sha}&to=${encodeURIComponent(mergeRequest.target_branch)}`;
    const compareResponse = JSON.parse(glab(["api", ...hostArgs, compareApiPath]));
    behindBy = compareResponse.commits?.length ?? 0;
  }
  const pipelines = JSON.parse(
    glab(["api", ...hostArgs, `${mrApiPath}/pipelines?per_page=1`])
  );
  return {
    prState,
    headSha: mergeRequest.sha,
    actionableThreadIds: selectActionableThreadIds(
      mapGitlabDiscussionsToThreadSnapshots(discussions)
    ),
    // GitLab has no review envelope — feedback is always a discussion
    // (contract.md Step 3b is GitHub-only), so there is no body-only source.
    actionableBodyReviewIds: [],
    behindBy,
    isConflicting: isGitlabMrConflicting(mergeRequest.detailed_merge_status ?? ""),
    ciBucket: mapGitlabPipelineStatusToCiBucket(pipelines[0]?.status ?? null)
  };
}
function pollSlotPrSnapshot(slot) {
  return (slot.prRecord.provider ?? "github") === "gitlab" ? pollGitlabMrSnapshot(slot) : pollGithubPrSnapshot(slot);
}
function spawnHeadlessTick(slot, spawnReason) {
  const claudeCommand = process.env.MUGGLE_WATCHDOG_CLAUDE_CMD ?? "claude";
  const claudeArgs = process.env.MUGGLE_WATCHDOG_CLAUDE_ARGS ?? "--permission-mode acceptEdits --allowedTools Bash Read Write Edit Glob Grep Skill";
  const tickPrompt = `/muggle:muggle-pr-followup ${slot.slug} ${slot.prRecord.number}`;
  const command = `${claudeCommand} ${claudeArgs} -p "${tickPrompt}"`;
  log(`spawn tick slug=${slot.slug} pr=${slot.prRecord.number} reason=${spawnReason}`);
  const child = spawn$1(command, {
    shell: true,
    detached: true,
    stdio: "ignore",
    cwd: homedir(),
    windowsHide: true
  });
  child.on("error", (error) => log(`spawn failed slug=${slot.slug}: ${String(error)}`));
  child.unref();
}
function scanOnce(nowMs) {
  const openSlots = listOpenSlots();
  const spawnCandidates = [];
  for (const slot of openSlots) {
    try {
      const followupLogText = readTextOrEmpty(join(slot.slotDir, "followup.log"));
      const newestLogMs = newestFollowupLogTimestampMs(followupLogText);
      const watcherLive = isWatcherLive({
        heartbeatMtimeMs: mtimeMsOrNull(join(slot.slotDir, WATCH_HEARTBEAT_FILENAME)),
        newestFollowupLogTimestampMs: newestLogMs,
        nowMs
      });
      const cycleInProgress = !watcherLive && isCycleInProgress({ logText: followupLogText, nowMs });
      if (watcherLive || cycleInProgress) continue;
      const pollSnapshot = pollSlotPrSnapshot(slot);
      const slotStateFile = join(slot.slotDir, WATCHDOG_SLOT_STATE_FILENAME);
      const decision = decideSlotAction({
        isWatcherLive: false,
        isCycleInProgress: false,
        pollSnapshot,
        signature: computeSlotSignature(pollSnapshot),
        storedSlotState: readJsonOrNull(slotStateFile) ?? emptyWatchdogSlotState(),
        newestFollowupLogTimestampMs: newestLogMs,
        nowMs,
        confirmSignalAfterMs: PENDING_SIGNAL_CONFIRM_AFTER_MS,
        spawnRetryAfterMs: SPAWN_RETRY_AFTER_MS
      });
      if (decision.action === "spawn-tick" /* SpawnTick */) {
        spawnCandidates.push({
          slot,
          spawnReason: decision.spawnReason ?? "confirmed-signal" /* ConfirmedSignal */,
          updatedSlotState: decision.updatedSlotState
        });
      } else if (decision.updatedSlotState) {
        writeFileSync(slotStateFile, JSON.stringify(decision.updatedSlotState, null, 2));
      }
    } catch (error) {
      log(`slot ${slot.slug}: ${String(error)}`);
    }
  }
  spawnCandidates.sort(
    (a, b) => a.spawnReason === b.spawnReason ? 0 : a.spawnReason === "terminal-pr" /* TerminalPr */ ? -1 : 1
  );
  const spawningNow = spawnCandidates.slice(0, MAX_TICK_SPAWNS_PER_SCAN);
  for (const candidate of spawningNow) {
    writeFileSync(
      join(candidate.slot.slotDir, WATCHDOG_SLOT_STATE_FILENAME),
      JSON.stringify(candidate.updatedSlotState, null, 2)
    );
    spawnHeadlessTick(candidate.slot, candidate.spawnReason);
  }
  return { openSlotCount: openSlots.length, spawnedCount: spawningNow.length };
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function liveLockPid() {
  const lock = readJsonOrNull(lockFile);
  if (!lock || typeof lock.pid !== "number") return null;
  if (!isProcessAlive(lock.pid)) return null;
  const heartbeatMtimeMs = mtimeMsOrNull(heartbeatFile);
  if (heartbeatMtimeMs === null || Date.now() - heartbeatMtimeMs > 3 * scanIntervalMs) return null;
  return lock.pid;
}
function ensureDaemon() {
  if (liveLockPid() !== null) return;
  mkdirSync(muggleDoDir, { recursive: true });
  const logFd = openSync(logFile, "a");
  const child = spawn$1(process.execPath, [fileURLToPath(import.meta.url), "run"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true
  });
  child.unref();
  log(`ensure: spawned watchdog daemon pid=${child.pid}`);
}
async function runDaemon() {
  const otherPid = liveLockPid();
  if (otherPid !== null && otherPid !== process.pid) {
    log(`run: daemon already live (pid=${otherPid}); exiting`);
    return;
  }
  mkdirSync(muggleDoDir, { recursive: true });
  const lock = { pid: process.pid, started_at: (/* @__PURE__ */ new Date()).toISOString() };
  writeFileSync(lockFile, JSON.stringify(lock, null, 2));
  log(`run: watchdog daemon started pid=${process.pid} intervalMs=${scanIntervalMs}`);
  try {
    for (; ; ) {
      writeFileSync(heartbeatFile, (/* @__PURE__ */ new Date()).toISOString());
      let openSlotCount = 0;
      try {
        const scanResult = scanOnce(Date.now());
        openSlotCount = scanResult.openSlotCount;
      } catch (error) {
        log(`scan error: ${String(error)}`);
        openSlotCount = 1;
      }
      if (openSlotCount === 0) {
        log("run: no open slots remain; exiting");
        return;
      }
      await setTimeout(scanIntervalMs);
    }
  } finally {
    rmSync(lockFile, { force: true });
  }
}
var subcommand = process.argv[2];
if (subcommand === "ensure") {
  ensureDaemon();
} else if (subcommand === "run") {
  await runDaemon();
} else if (subcommand === "scan-once") {
  const scanResult = scanOnce(Date.now());
  process.stdout.write(`${JSON.stringify(scanResult)}
`);
} else {
  process.stderr.write("usage: pr-followup-watchdog.mjs <ensure|run|scan-once>\n");
  process.exitCode = 2;
}
