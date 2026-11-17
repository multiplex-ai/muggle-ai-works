import { createHash, randomUUID } from 'crypto';
import { mkdirSync, appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { dirname, join } from 'path';
import * as os from 'os';

// src/guardrails/constants.ts
var HOOK_HOST_ENV_VAR = "MUGGLE_HOOK_HOST";
function mcpToolNamePattern(hyphenatedSource) {
  return new RegExp(hyphenatedSource.replaceAll("-", "[-_]"), "i");
}
mcpToolNamePattern("muggle-local-telemetry-skill-emit");
mcpToolNamePattern("muggle-local-(execute-test-generation|execute-replay)");
mcpToolNamePattern(
  "muggle-(local-execute-(test-generation|replay)|remote-workflow-start-test-script-replay)"
);
mcpToolNamePattern("muggle-local-telemetry-event-emit");
mcpToolNamePattern("muggle-remote-user-feedback-create");

// src/guardrails/hookHost.ts
function resolveHookHost(env = process.env) {
  if (env[HOOK_HOST_ENV_VAR] === "codex") return "codex";
  if (env.CURSOR_PLUGIN_ROOT) return "cursor";
  return "claude";
}

// src/watch-qos/constants.ts
var WATCH_QOS_DIR_NAME = "telemetry";
var WATCH_QOS_LEDGER_FILE_NAME = "watch-qos.jsonl";
var WATCH_QOS_ROTATED_LEDGER_FILE_NAME = "watch-qos.1.jsonl";
var WATCH_QOS_CURSOR_FILE_NAME = "watch-qos.cursor.json";
var WATCH_QOS_IDENTITY_HEX_LENGTH = 32;
var WATCH_QOS_IDENTITY_SEPARATOR = "\n";
var WATCH_QOS_DEDUP_KEY_SEPARATOR = "|";
var WATCH_QOS_LEDGER_ENV_VAR = "MUGGLE_WATCH_QOS_LEDGER";
var WATCH_QOS_LEDGER_DISABLED_VALUE = "off";
var WATCH_QOS_RECORD_FLAGS = {
  signal: "--signal",
  detector: "--detector",
  repo: "--repo",
  pr: "--pr",
  head: "--head",
  occurrence: "--occurrence"
};

// src/watch-qos/types.ts
var WatchQosSignal = /* @__PURE__ */ ((WatchQosSignal2) => {
  WatchQosSignal2["PrOpened"] = "pr-opened";
  WatchQosSignal2["WatchArmed"] = "watch-armed";
  WatchQosSignal2["WatchMissed"] = "watch-missed";
  WatchQosSignal2["WatchSkipped"] = "watch-skipped";
  WatchQosSignal2["WatcherDown"] = "watcher-down";
  WatchQosSignal2["WatcherRecovered"] = "watcher-recovered";
  WatchQosSignal2["CiRedObserved"] = "ci-red-observed";
  WatchQosSignal2["CiRedHandled"] = "ci-red-handled";
  WatchQosSignal2["CiRedLate"] = "ci-red-late";
  WatchQosSignal2["CiRedCaughtAtTurnEnd"] = "ci-red-caught-at-turn-end";
  WatchQosSignal2["MergedRed"] = "merged-red";
  WatchQosSignal2["ClosedRed"] = "closed-red";
  return WatchQosSignal2;
})(WatchQosSignal || {});
var WatchQosDetector = /* @__PURE__ */ ((WatchQosDetector2) => {
  WatchQosDetector2["TurnEndGate"] = "turn-end-gate";
  WatchQosDetector2["FollowThroughGate"] = "follow-through-gate";
  WatchQosDetector2["WatchService"] = "watch-service";
  WatchQosDetector2["WatchLoop"] = "watch-loop";
  WatchQosDetector2["Cleanup"] = "cleanup";
  return WatchQosDetector2;
})(WatchQosDetector || {});
var WatchQosHost = /* @__PURE__ */ ((WatchQosHost2) => {
  WatchQosHost2["ClaudeCode"] = "claude-code";
  WatchQosHost2["Codex"] = "codex";
  return WatchQosHost2;
})(WatchQosHost || {});

// src/watch-qos/host.ts
function watchQosHostOfHookHost(host) {
  return host === "codex" ? "codex" /* Codex */ : "claude-code" /* ClaudeCode */;
}
var DATA_DIR_NAME = ".muggle-ai";
function getDataDir() {
  return path.join(os.homedir(), DATA_DIR_NAME);
}

// packages/mcps/src/shared/install_id.ts
var INSTALL_ID_FILENAME = "install-id.json";
var cachedInstallId;
function installIdFilePath() {
  return join(getDataDir(), INSTALL_ID_FILENAME);
}
function generateAndPersist(filePath) {
  const installId = randomUUID();
  const contents = { installId };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(contents, null, 2) + "\n", "utf8");
  return installId;
}
function isValid(value) {
  return typeof value === "object" && value !== null && typeof value.installId === "string" && value.installId.length > 0;
}
function getInstallId() {
  if (cachedInstallId !== void 0) return cachedInstallId;
  const filePath = installIdFilePath();
  if (!existsSync(filePath)) {
    cachedInstallId = generateAndPersist(filePath);
    return cachedInstallId;
  }
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (isValid(parsed)) {
      cachedInstallId = parsed.installId;
      return cachedInstallId;
    }
    cachedInstallId = generateAndPersist(filePath);
    return cachedInstallId;
  } catch {
    cachedInstallId = generateAndPersist(filePath);
    return cachedInstallId;
  }
}

// src/watch-qos/identity.ts
function prReferenceOf(repo2, prNumber2) {
  return `${repo2}#${prNumber2}`;
}
function hashWatchQosIdentity(identity, salt) {
  return createHash("sha256").update(`${salt}${WATCH_QOS_IDENTITY_SEPARATOR}${identity}`).digest("hex").slice(0, WATCH_QOS_IDENTITY_HEX_LENGTH);
}
function resolveWatchQosSalt() {
  return getInstallId();
}
function resolveWatchQosPaths(watchQosDir = join(getDataDir(), WATCH_QOS_DIR_NAME)) {
  return {
    ledgerFile: join(watchQosDir, WATCH_QOS_LEDGER_FILE_NAME),
    rotatedLedgerFile: join(watchQosDir, WATCH_QOS_ROTATED_LEDGER_FILE_NAME),
    cursorFile: join(watchQosDir, WATCH_QOS_CURSOR_FILE_NAME)
  };
}
function watchQosDedupKey(record) {
  return [record.signal, record.subjectId, record.headId ?? "", record.occurrenceKey ?? ""].join(WATCH_QOS_DEDUP_KEY_SEPARATOR);
}
function isEnumValue(enumObject, candidate) {
  return typeof candidate === "string" && Object.values(enumObject).includes(candidate);
}
function optionalStringField(candidate) {
  return typeof candidate === "string" && candidate !== "" ? candidate : void 0;
}
function parseWatchQosLedgerLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null) return void 0;
  const { at, signal: signal2, detector: detector2, subjectId, host } = parsed;
  if (typeof at !== "string" || typeof subjectId !== "string" || subjectId === "") return void 0;
  if (!isEnumValue(WatchQosSignal, signal2) || !isEnumValue(WatchQosDetector, detector2) || !isEnumValue(WatchQosHost, host)) {
    return void 0;
  }
  const delaySeconds = parsed.delaySeconds;
  return {
    at,
    signal: signal2,
    detector: detector2,
    subjectId,
    headId: optionalStringField(parsed.headId),
    delaySeconds: typeof delaySeconds === "number" && Number.isFinite(delaySeconds) ? delaySeconds : void 0,
    host,
    occurrenceKey: optionalStringField(parsed.occurrenceKey)
  };
}
function readLedgerLines(filePath) {
  try {
    return readFileSync(filePath, "utf-8").split("\n");
  } catch {
    return [];
  }
}
function readWatchQosRecords(paths) {
  return [...readLedgerLines(paths.rotatedLedgerFile), ...readLedgerLines(paths.ledgerFile)].flatMap((line) => {
    const record = line.trim() === "" ? void 0 : parseWatchQosLedgerLine(line);
    return record ? [record] : [];
  });
}
function appendWatchQosRecord(paths, record) {
  const dedupKey = watchQosDedupKey(record);
  if (readWatchQosRecords(paths).some((existing) => watchQosDedupKey(existing) === dedupKey)) return false;
  mkdirSync(dirname(paths.ledgerFile), { recursive: true });
  appendFileSync(paths.ledgerFile, `${JSON.stringify(record)}
`);
  return true;
}

// src/watch-qos/recorder.ts
function isLedgerDisabled() {
  return process.env[WATCH_QOS_LEDGER_ENV_VAR] === WATCH_QOS_LEDGER_DISABLED_VALUE;
}
function toWatchQosLedgerRecord(observation, salt, nowMs) {
  return {
    at: new Date(nowMs).toISOString(),
    signal: observation.signal,
    detector: observation.detector,
    subjectId: hashWatchQosIdentity(observation.prReference, salt),
    headId: observation.headSha ? hashWatchQosIdentity(observation.headSha, salt) : void 0,
    delaySeconds: observation.delaySeconds === void 0 ? void 0 : Math.max(0, Math.round(observation.delaySeconds)),
    host: observation.host,
    occurrenceKey: observation.occurrenceKey
  };
}
function recordWatchQosObservation(observation, nowMs = Date.now(), paths = resolveWatchQosPaths()) {
  if (isLedgerDisabled()) return false;
  try {
    return appendWatchQosRecord(paths, toWatchQosLedgerRecord(observation, resolveWatchQosSalt(), nowMs));
  } catch {
    return false;
  }
}

// src/watch-qos/cli.ts
function flagValue(argv2, flag) {
  const flagIndex = argv2.indexOf(flag);
  const flagArgument = flagIndex === -1 ? void 0 : argv2[flagIndex + 1];
  return flagArgument === void 0 || flagArgument === "" || flagArgument.startsWith("--") ? void 0 : flagArgument;
}
function enumValueOf(enumObject, candidate) {
  return Object.values(enumObject).find((enumValue) => enumValue === candidate);
}
var argv = process.argv.slice(2);
var signal = enumValueOf(WatchQosSignal, flagValue(argv, WATCH_QOS_RECORD_FLAGS.signal));
var detector = enumValueOf(WatchQosDetector, flagValue(argv, WATCH_QOS_RECORD_FLAGS.detector));
var repo = flagValue(argv, WATCH_QOS_RECORD_FLAGS.repo);
var prNumber = flagValue(argv, WATCH_QOS_RECORD_FLAGS.pr);
if (signal !== void 0 && detector !== void 0 && repo !== void 0 && prNumber !== void 0) {
  recordWatchQosObservation({
    signal,
    detector,
    prReference: prReferenceOf(repo, prNumber),
    headSha: flagValue(argv, WATCH_QOS_RECORD_FLAGS.head),
    host: watchQosHostOfHookHost(resolveHookHost()),
    occurrenceKey: flagValue(argv, WATCH_QOS_RECORD_FLAGS.occurrence)
  });
}
