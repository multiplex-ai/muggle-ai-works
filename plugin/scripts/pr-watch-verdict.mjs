import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// src/pr-watch/cli.ts

// src/pr-watch/constants.ts
var MAX_REBASE_ATTEMPTS_PER_KEY = 2;
var MAX_CI_FIX_ATTEMPTS_PER_HEAD = 3;
var REBASE_KEY_SEPARATOR = "..";
var USER_PREFERENCES_PATH_SEGMENTS = [".muggle-ai", "preferences.json"];
var PREFERENCE_DEFAULTS_PATH_SEGMENTS = ["config", "preference-defaults.json"];
var AUTO_REBASE_PREFERENCE_KEY = "autoRebase";
var MAX_CATCH_UP_REBASES_PREFERENCE_KEY = "maxCatchUpRebases";
var WATCHER_LIFETIME_PREFERENCE_KEY = "watcherLifetime";
var WATCHER_LIFETIME_SECONDS = { "1d": 86400, "7d": 604800, never: 0 };
var UNBOUNDED_PREFERENCE_VALUE = "never";
var POSITIVE_INTEGER = /^[1-9]\d*$/;
var LINE_BREAK = /[\r\n]/;
var PR_KEY_FLAG = "pr-key";
var HEAD_FLAG = "head";
var REBASE_KEY_FLAG = "rebase-key";
var REBASE_DUE_FLAG = "rebase-due";
var CI_FLAG = "ci";
var BODY_REVIEWS_FLAG = "body-reviews";
var CONVERSATION_COMMENTS_FLAG = "conversation-comments";
var UNANSWERED_THREADS_FLAG = "unanswered-threads";
var STATE_LIST_SEPARATOR = ",";
var THREAD_COMMENT_REVIEW_SEPARATOR = ":";
var REBASE_DUE_YES = "yes";
var USAGE_EXIT_CODE = 2;
var PR_WATCH_VERDICT_USAGE = "usage: pr-watch-verdict.mjs arm-floors --pr-key <owner/repo#n> --head <sha> --rebase-key <head..base-tip> [--body-reviews <ids>] [--conversation-comments <ids>] [--unanswered-threads <comment:review,...>] < last_seen.json\n       pr-watch-verdict.mjs tick --pr-key <owner/repo#n> --head <sha> --rebase-key <head..base-tip> --rebase-due <yes|no> --ci <red|pending|green> < last_seen.json";

// src/pr-watch/attempts.ts
function recordedCount(counts, key) {
  const recorded = counts?.[key];
  return typeof recorded === "number" && Number.isFinite(recorded) ? recorded : 0;
}
function rebaseAttemptsFor(lastSeenEntry, rebaseKey) {
  return recordedCount(lastSeenEntry.conflict_resolve_attempts, rebaseKey);
}
function ciFixAttemptsFor(lastSeenEntry, headSha) {
  return recordedCount(lastSeenEntry.ci_fix_attempts, headSha);
}
function isRebaseKeyAttempted(lastSeenEntry, rebaseKey) {
  return rebaseAttemptsFor(lastSeenEntry, rebaseKey) >= 1;
}
function isCiHeadAttempted(lastSeenEntry, headSha) {
  return ciFixAttemptsFor(lastSeenEntry, headSha) >= 1;
}
function isRebaseKeyEscalated(lastSeenEntry, rebaseKey) {
  return rebaseKey.includes(REBASE_KEY_SEPARATOR) && (lastSeenEntry.conflict_escalated_keys ?? []).includes(rebaseKey) && isRebaseKeyAttempted(lastSeenEntry, rebaseKey);
}
function isCiHeadEscalated(lastSeenEntry, headSha) {
  return (lastSeenEntry.ci_escalated_shas ?? []).includes(headSha) && isCiHeadAttempted(lastSeenEntry, headSha);
}
function isCiHeadBudgetSpent(lastSeenEntry, headSha) {
  return ciFixAttemptsFor(lastSeenEntry, headSha) >= MAX_CI_FIX_ATTEMPTS_PER_HEAD;
}
function isCiHeadSettled(lastSeenEntry, headSha) {
  return isCiHeadEscalated(lastSeenEntry, headSha) || isCiHeadBudgetSpent(lastSeenEntry, headSha);
}
function isRebaseBudgetExhausted(lastSeenEntry, maxCatchUpRebases) {
  const catchUpRebases = lastSeenEntry.catch_up_rebases;
  return maxCatchUpRebases !== null && typeof catchUpRebases === "number" && catchUpRebases >= maxCatchUpRebases;
}
function hasEscalatedReviewFeedback(lastSeenEntry) {
  return [lastSeenEntry.escalated_review_ids, lastSeenEntry.escalated_conversation_comment_ids].some(
    (escalatedIds) => Array.isArray(escalatedIds) && escalatedIds.length > 0
  );
}

// src/pr-watch/unhandledFeedback.ts
function parseFeedbackId(text) {
  const parsed = Number(text.trim());
  return text.trim() !== "" && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : void 0;
}
function parseFeedbackIdList(listText) {
  return listText.split(STATE_LIST_SEPARATOR).map(parseFeedbackId).filter((feedbackId) => feedbackId !== void 0);
}
function parseUnansweredThreadComments(listText) {
  const threadComments = [];
  for (const entry of listText.split(STATE_LIST_SEPARATOR)) {
    const [commentText = "", reviewText = ""] = entry.split(THREAD_COMMENT_REVIEW_SEPARATOR);
    const commentId = parseFeedbackId(commentText);
    if (commentId === void 0) continue;
    threadComments.push({ commentId, owningReviewId: parseFeedbackId(reviewText) });
  }
  return threadComments;
}
function handledWatermark(recorded) {
  return typeof recorded === "number" && Number.isFinite(recorded) ? recorded : void 0;
}
function floorCeilingBelow(feedbackIds) {
  return feedbackIds.length > 0 ? Math.min(...feedbackIds) - 1 : void 0;
}
var ascendingUnique = (feedbackIds) => [...new Set(feedbackIds)].sort((left, right) => left - right);
function resolveUnhandledFeedback(lastSeenEntry, observation) {
  const escalatedReviewIds = new Set(lastSeenEntry.escalated_review_ids ?? []);
  const escalatedConversationIds = new Set(lastSeenEntry.escalated_conversation_comment_ids ?? []);
  const handledBodyReviewId = handledWatermark(lastSeenEntry.lastBodyReviewId);
  const handledConversationId = handledWatermark(lastSeenEntry.lastConversationCommentId);
  const unhandledBodyReviewIds = handledBodyReviewId === void 0 ? [] : observation.bodyOnlyReviewIds.filter(
    (reviewId) => reviewId > handledBodyReviewId && !escalatedReviewIds.has(reviewId)
  );
  const unansweredThreadComments = observation.unansweredThreadComments.filter(
    (threadComment) => threadComment.owningReviewId === void 0 || !escalatedReviewIds.has(threadComment.owningReviewId)
  );
  const unhandledConversationIds = handledConversationId === void 0 ? [] : observation.conversationCommentIds.filter(
    (commentId) => commentId > handledConversationId && !escalatedConversationIds.has(commentId)
  );
  const threadOwningReviewIds = unansweredThreadComments.map((threadComment) => threadComment.owningReviewId).filter((reviewId) => reviewId !== void 0);
  return {
    reviewIds: ascendingUnique([...unhandledBodyReviewIds, ...threadOwningReviewIds]),
    conversationCommentIds: ascendingUnique(unhandledConversationIds),
    reviewFloorCeiling: floorCeilingBelow(unhandledBodyReviewIds),
    commentFloorCeiling: floorCeilingBelow(unansweredThreadComments.map((threadComment) => threadComment.commentId)),
    conversationFloorCeiling: floorCeilingBelow(unhandledConversationIds)
  };
}

// src/pr-watch/armFloors.ts
function resolveArmFloorEvidence(lastSeenEntry, headSha, rebaseKey, maxCatchUpRebases, feedbackObservation) {
  const blockedCiDigest = lastSeenEntry.blocked?.fingerprint?.ci_digest;
  return {
    isRebaseKeyAttempted: rebaseKey !== "" && isRebaseKeyAttempted(lastSeenEntry, rebaseKey),
    isCiHeadSettled: headSha !== "" && isCiHeadSettled(lastSeenEntry, headSha),
    isRebaseBudgetExhausted: isRebaseBudgetExhausted(lastSeenEntry, maxCatchUpRebases),
    blockedCiDigest: typeof blockedCiDigest === "string" && !LINE_BREAK.test(blockedCiDigest) ? blockedCiDigest : "",
    unhandledFeedback: resolveUnhandledFeedback(lastSeenEntry, feedbackObservation)
  };
}
function readJsonRecord(filePath) {
  try {
    return asRecord(JSON.parse(readFileSync(filePath, "utf-8")));
  } catch {
    return {};
  }
}
function asRecord(candidate) {
  return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : {};
}
function lastSeenEntryFor(lastSeenJson, prKey) {
  try {
    return asRecord(asRecord(JSON.parse(lastSeenJson))[prKey]);
  } catch {
    return {};
  }
}

// src/pr-watch/types.ts
var CiRollupBucket = /* @__PURE__ */ ((CiRollupBucket2) => {
  CiRollupBucket2["Red"] = "red";
  CiRollupBucket2["Pending"] = "pending";
  CiRollupBucket2["Green"] = "green";
  return CiRollupBucket2;
})(CiRollupBucket || {});

// src/pr-watch/tickVerdict.ts
function resolveWatchTickVerdict(lastSeenEntry, observation, preferences) {
  const { headSha, rebaseKey } = observation;
  if (lastSeenEntry.forward_stages_in_flight === true) return "hold-forward-stages" /* HoldForwardStages */;
  if (observation.isRebaseDue) {
    if (isRebaseBudgetExhausted(lastSeenEntry, preferences.maxCatchUpRebases)) {
      return "block-rebase-budget-exhausted" /* BlockRebaseBudgetExhausted */;
    }
    const isRebaseKeyBudgetLeft = rebaseAttemptsFor(lastSeenEntry, rebaseKey) < MAX_REBASE_ATTEMPTS_PER_KEY;
    if (isRebaseKeyBudgetLeft && !isRebaseKeyEscalated(lastSeenEntry, rebaseKey)) return "dispatch-rebase" /* DispatchRebase */;
  }
  if (observation.ciBucket === "red" /* Red */) {
    const isCiHeadBudgetLeft = ciFixAttemptsFor(lastSeenEntry, headSha) < MAX_CI_FIX_ATTEMPTS_PER_HEAD;
    if (isCiHeadBudgetLeft && !isCiHeadEscalated(lastSeenEntry, headSha)) return "dispatch-fix-ci" /* DispatchFixCi */;
  }
  if (isRebaseKeyEscalated(lastSeenEntry, rebaseKey)) return "block-conflict-escalated" /* BlockConflictEscalated */;
  const isRedHeadOutOfAttempts = observation.ciBucket === "red" /* Red */ && isCiHeadBudgetSpent(lastSeenEntry, headSha);
  if (isCiHeadEscalated(lastSeenEntry, headSha) || isRedHeadOutOfAttempts) return "block-ci-escalated" /* BlockCiEscalated */;
  if (hasEscalatedReviewFeedback(lastSeenEntry)) return "block-reviews-escalated" /* BlockReviewsEscalated */;
  return "idle" /* Idle */;
}

// src/pr-watch/verdictCommand.ts
function parseVerdictArguments(flagTokens) {
  const parsed = {};
  for (let index = 0; index < flagTokens.length; index += 1) {
    const token = flagTokens[index];
    if (!token.startsWith("--")) continue;
    const next = flagTokens[index + 1];
    const hasValue = next !== void 0 && !next.startsWith("--");
    parsed[token.slice(2)] = hasValue ? next : "";
    if (hasValue) index += 1;
  }
  return parsed;
}
var usageFailure = (problem) => ({
  stdout: "",
  stderr: `pr-watch-verdict: ${problem}
${PR_WATCH_VERDICT_USAGE}
`,
  exitCode: USAGE_EXIT_CODE
});
function runPrWatchVerdictCommand(commandLine, lastSeenJson, resolvePreferences) {
  const [subcommand, ...flagTokens] = commandLine;
  const flags = parseVerdictArguments(flagTokens);
  const prKey = flags[PR_KEY_FLAG];
  if (!prKey) return usageFailure(`--${PR_KEY_FLAG} is required`);
  const lastSeenEntry = lastSeenEntryFor(lastSeenJson, prKey);
  const headSha = flags[HEAD_FLAG] ?? "";
  const rebaseKey = flags[REBASE_KEY_FLAG] ?? "";
  if (subcommand === "arm-floors" /* ArmFloors */) {
    const evidence = resolveArmFloorEvidence(lastSeenEntry, headSha, rebaseKey, resolvePreferences().maxCatchUpRebases, {
      bodyOnlyReviewIds: parseFeedbackIdList(flags[BODY_REVIEWS_FLAG] ?? ""),
      conversationCommentIds: parseFeedbackIdList(flags[CONVERSATION_COMMENTS_FLAG] ?? ""),
      unansweredThreadComments: parseUnansweredThreadComments(flags[UNANSWERED_THREADS_FLAG] ?? "")
    });
    const { unhandledFeedback } = evidence;
    return {
      stdout: `REBASE_ATTEMPTED=${evidence.isRebaseKeyAttempted ? 1 : 0}
CI_SETTLED=${evidence.isCiHeadSettled ? 1 : 0}
BLOCKED_CIDIGEST=${evidence.blockedCiDigest}
REBASE_BUDGET_EXHAUSTED=${evidence.isRebaseBudgetExhausted ? 1 : 0}
UNHANDLED_REVIEW_IDS=${unhandledFeedback.reviewIds.join(" ")}
UNHANDLED_CONVERSATION_IDS=${unhandledFeedback.conversationCommentIds.join(" ")}
REVIEW_FLOOR_CEILING=${unhandledFeedback.reviewFloorCeiling ?? ""}
COMMENT_FLOOR_CEILING=${unhandledFeedback.commentFloorCeiling ?? ""}
CONVERSATION_FLOOR_CEILING=${unhandledFeedback.conversationFloorCeiling ?? ""}
`,
      stderr: "",
      exitCode: 0
    };
  }
  if (subcommand === "tick" /* Tick */) {
    const ciBucket = Object.values(CiRollupBucket).find((bucket) => bucket === flags[CI_FLAG]);
    if (!ciBucket) return usageFailure(`--${CI_FLAG} must be one of ${Object.values(CiRollupBucket).join(", ")}`);
    if (!headSha || !rebaseKey) return usageFailure(`--${HEAD_FLAG} and --${REBASE_KEY_FLAG} are required`);
    const verdict = resolveWatchTickVerdict(
      lastSeenEntry,
      { headSha, rebaseKey, isRebaseDue: flags[REBASE_DUE_FLAG] === REBASE_DUE_YES, ciBucket },
      resolvePreferences()
    );
    return { stdout: `VERDICT=${verdict}
`, stderr: "", exitCode: 0 };
  }
  return usageFailure(`unknown subcommand ${subcommand ?? "(none)"}`);
}
function resolvePluginRoot(env = process.env) {
  return env.CLAUDE_PLUGIN_ROOT || env.CURSOR_PLUGIN_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
}

// src/pr-watch/watchPreferences.ts
function parseMaxCatchUpRebases(configuredValue) {
  if (configuredValue === UNBOUNDED_PREFERENCE_VALUE) return null;
  const spelled = typeof configuredValue === "number" ? String(configuredValue) : configuredValue;
  return typeof spelled === "string" && POSITIVE_INTEGER.test(spelled) ? Number(spelled) : void 0;
}
var readUserPreferences = (homeDir) => asRecord(readJsonRecord(join(homeDir, ...USER_PREFERENCES_PATH_SEGMENTS)).preferences);
function readPreferenceLayers(homeDir, pluginRoot) {
  return [readUserPreferences(homeDir), readJsonRecord(join(pluginRoot, ...PREFERENCE_DEFAULTS_PATH_SEGMENTS))];
}
function pickPreferenceValue(preferenceLayers, preferenceKey) {
  const configuredValue = preferenceLayers.map((layer) => layer[preferenceKey]).find((layerValue) => layerValue != null);
  return typeof configuredValue === "string" ? configuredValue : void 0;
}
function resolveWatchPreferences(homeDir = homedir(), pluginRoot = resolvePluginRoot()) {
  const preferenceLayers = readPreferenceLayers(homeDir, pluginRoot);
  const [userPreferences, shippedDefaults] = preferenceLayers;
  const autoRebase = pickPreferenceValue(preferenceLayers, AUTO_REBASE_PREFERENCE_KEY);
  const userCap = parseMaxCatchUpRebases(userPreferences[MAX_CATCH_UP_REBASES_PREFERENCE_KEY]);
  const shippedCap = parseMaxCatchUpRebases(shippedDefaults[MAX_CATCH_UP_REBASES_PREFERENCE_KEY]);
  const lifetimeSecondsOf = (configuredValue) => typeof configuredValue === "string" ? WATCHER_LIFETIME_SECONDS[configuredValue] : void 0;
  return {
    autoRebase,
    maxCatchUpRebases: userCap !== void 0 ? userCap : shippedCap ?? null,
    watcherLifetimeSeconds: lifetimeSecondsOf(userPreferences[WATCHER_LIFETIME_PREFERENCE_KEY]) ?? lifetimeSecondsOf(shippedDefaults[WATCHER_LIFETIME_PREFERENCE_KEY])
  };
}

// src/pr-watch/cli.ts
function readLastSeenFromStdin() {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}
var outcome = runPrWatchVerdictCommand(process.argv.slice(2), readLastSeenFromStdin(), () => resolveWatchPreferences());
process.stderr.write(outcome.stderr);
process.stdout.write(outcome.stdout);
process.exitCode = outcome.exitCode;
