import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join, isAbsolute, resolve, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

// src/guardrails/cli.ts
var baseDir = (override) => override ?? join(homedir(), ".muggle-ai", "guardrails");
var fileFor = (sessionId2, override) => join(baseDir(override), `${sessionId2.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
function readState(sessionId2, dirOverride) {
  const f = fileFor(sessionId2, dirOverride);
  if (!existsSync(f)) return { sessionId: sessionId2, prsHandled: [] };
  try {
    const raw = JSON.parse(readFileSync(f, "utf-8"));
    return { ...raw, sessionId: sessionId2, prsHandled: raw.prsHandled ?? [] };
  } catch {
    return { sessionId: sessionId2, prsHandled: [] };
  }
}
function writeState(state, dirOverride) {
  mkdirSync(baseDir(dirOverride), { recursive: true });
  writeFileSync(fileFor(state.sessionId, dirOverride), JSON.stringify(state, null, 2));
}
function markPrHandled(sessionId2, prUrl, dirOverride) {
  const state = readState(sessionId2, dirOverride);
  if (!state.prsHandled.includes(prUrl)) state.prsHandled.push(prUrl);
  writeState(state, dirOverride);
}

// src/guardrails/prOpened.ts
var PR_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/;
var MR_URL = /https?:\/\/[^/\s]+\/[^\s]+\/-\/merge_requests\/\d+/;
var CREATE_CMD = /\bgh\s+pr\s+(create|ready)\b/;
var MR_CREATE_CMD = /\bglab\s+mr\s+create\b|\bglab\s+mr\s+update\b.*--ready\b/;
function detectPrOpened(input2) {
  if (input2.tool_name !== "Bash") return null;
  const cmd = input2.tool_input?.command ?? "";
  if (!CREATE_CMD.test(cmd) && !MR_CREATE_CMD.test(cmd)) return null;
  const out = `${input2.tool_response?.stdout ?? ""}
${input2.tool_response?.output ?? ""}`;
  const m = out.match(PR_URL) ?? out.match(MR_URL);
  return m ? m[0] : null;
}

// src/guardrails/constants.ts
var GH_PR_MERGED_LINE = /\b(?:Merged|Squashed and merged|Rebased and merged) pull request [\w./-]*#(\d+)/;
var GH_PR_CLOSED_LINE = /\bClosed pull request [\w./-]*#(\d+)/;
var GH_PR_REOPENED_LINE = /\bReopened pull request [\w./-]*#(\d+)/;
var PR_MONITOR_TERMINAL_LINE = /\bTERMINAL pr=(\d+): (MERGED|CLOSED)\b/;
var MAX_PR_TERMINAL_BLOCKS = 3;
var MAX_WATCH_BLOCKS = 3;
var MAX_WALKTHROUGH_BLOCKS = 3;
var GH_LOOKUP_TIMEOUT_MS = 1e4;
var MUGGLE_SKILL_EMIT_TOOL = /muggle-local-telemetry-skill-emit/i;
var MUGGLE_TEST_SKILL_NAME = "muggle-test";
var MANDATORY_STAGES_FRONTMATTER_KEY = "mandatoryStages";
var SKILL_NAME_INPUT_KEYS = ["skill", "skillName", "name", "command"];
var MAX_STAGE_BLOCKS = 3;
var MAX_DEBUG_BLOCKS = 3;
var ANY_TEST_CASE = "*";
var MUGGLE_EXECUTION_TOOL = /muggle-local-(execute-test-generation|execute-replay)/i;
var MUGGLE_EVENT_EMIT_TOOL = /muggle-local-telemetry-event-emit/i;
var MUGGLE_FEEDBACK_CREATE_TOOL = /muggle-remote-user-feedback-create/i;
var PRE_EXECUTION_CLASSIFICATION_EVENT = "pre-execution-classification";
var FAILURE_DIAGNOSIS_EVENT = /-failure-(classified|resolved)$/;
var MUGGLE_RUN_ID_LINE = /\*\*Run ID:\*\*\s*([^\s*]+)/;
var MUGGLE_RUN_STATUS_LINE = /\*\*Status:\*\*\s*([A-Za-z_]+)/;
var MUGGLE_RUN_PASSED_STATUS = "passed";
var GITHUB_RESOLVE_THREAD_MUTATION = /\bresolveReviewThread\b/;
var GITLAB_RESOLVE_DISCUSSION_CALL = /discussions\/[^\s"']*[?&]resolved=true/i;
var PROVIDER_API_INVOCATION = /\b(?:gh|glab)\s+api\b/;

// src/guardrails/prTerminal.ts
function detectPrTerminal(input2) {
  if (input2.tool_name !== "Bash" && input2.tool_name !== "Monitor") return null;
  const response = input2.tool_response;
  const haystack = [response?.stdout, response?.stderr, response?.output, response?.content].filter((part) => typeof part === "string").join("\n");
  const mergedMatch = haystack.match(GH_PR_MERGED_LINE);
  if (mergedMatch) {
    return { prNumber: Number(mergedMatch[1]), verdict: "merged" /* Merged */ };
  }
  const closedMatch = haystack.match(GH_PR_CLOSED_LINE);
  if (closedMatch) {
    return { prNumber: Number(closedMatch[1]), verdict: "closed" /* Closed */ };
  }
  const monitorMatch = haystack.match(PR_MONITOR_TERMINAL_LINE);
  if (monitorMatch) {
    return {
      prNumber: Number(monitorMatch[1]),
      verdict: monitorMatch[2] === "MERGED" ? "merged" /* Merged */ : "closed" /* Closed */
    };
  }
  return null;
}
function detectPrReopened(input2) {
  if (input2.tool_name !== "Bash") return null;
  const response = input2.tool_response;
  const haystack = [response?.stdout, response?.stderr, response?.output, response?.content].filter((part) => typeof part === "string").join("\n");
  const reopenedMatch = haystack.match(GH_PR_REOPENED_LINE);
  return reopenedMatch ? Number(reopenedMatch[1]) : null;
}
function applyPrReopened(state, prNumber) {
  const pending = state.terminalPending ?? [];
  const handled = state.terminalHandled ?? [];
  if (!pending.includes(prNumber) && !handled.includes(prNumber)) return state;
  return {
    ...state,
    terminalPending: pending.filter((number) => number !== prNumber),
    terminalHandled: handled.filter((number) => number !== prNumber)
  };
}
function applyPrTerminalDetected(state, prNumber) {
  const pending = state.terminalPending ?? [];
  const handled = state.terminalHandled ?? [];
  if (pending.includes(prNumber) || handled.includes(prNumber)) return state;
  return { ...state, terminalPending: [...pending, prNumber] };
}
function applyNextOptionsOffered(state) {
  const pending = state.terminalPending ?? [];
  if (pending.length === 0) return state;
  return {
    ...state,
    terminalPending: [],
    terminalHandled: [...state.terminalHandled ?? [], ...pending],
    terminalBlockCount: 0
  };
}
function prTerminalGateDecision(state, maxBlocks = MAX_PR_TERMINAL_BLOCKS) {
  const blockCount = state.terminalBlockCount ?? 0;
  if ((state.terminalPending ?? []).length === 0) {
    return { action: "none" /* None */, blockCount };
  }
  if (blockCount >= maxBlocks) {
    return { action: "release" /* Release */, blockCount };
  }
  return { action: "block" /* Block */, blockCount: blockCount + 1 };
}
var FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
var SEQUENCE_ENTRY = /^\s*-\s*(.+?)\s*$/;
var FLOW_LIST = /^\s*\[(.*)\]\s*$/;
var STAGE_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_STAGE_SKIP\b/;
var SKILLS_DIR_NAME = "skills";
var SKILLS_PATH_SEGMENT = `/${SKILLS_DIR_NAME}/`;
var SINGLE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;
var unquote = (raw) => raw.trim().replace(/^["']|["']$/g, "").trim();
function parseDeclaredStages(skillMarkdown) {
  const frontmatter = FRONTMATTER.exec(skillMarkdown)?.[1];
  if (!frontmatter) return [];
  const lines = frontmatter.split(/\r?\n/);
  const keyIndex = lines.findIndex(
    (line) => line.startsWith(`${MANDATORY_STAGES_FRONTMATTER_KEY}:`)
  );
  if (keyIndex < 0) return [];
  const inlineValue = lines[keyIndex].slice(MANDATORY_STAGES_FRONTMATTER_KEY.length + 1).trim();
  const flowEntries = FLOW_LIST.exec(inlineValue)?.[1];
  if (flowEntries !== void 0) {
    return flowEntries.split(",").map(unquote).filter((entry) => entry.length > 0);
  }
  const declared = [];
  for (const line of lines.slice(keyIndex + 1)) {
    const entry = SEQUENCE_ENTRY.exec(line);
    if (!entry) break;
    declared.push(unquote(entry[1]));
  }
  return declared;
}
function normalizeStagePath(filePath) {
  return filePath.replaceAll("\\", "/").toLowerCase();
}
function stageLabel(normalizedStagePath) {
  const insideSkills = normalizedStagePath.lastIndexOf(SKILLS_PATH_SEGMENT);
  if (insideSkills < 0) return normalizedStagePath;
  return normalizedStagePath.slice(insideSkills + SKILLS_PATH_SEGMENT.length);
}
function resolvePluginSkillsRoot() {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || process.env.CURSOR_PLUGIN_ROOT;
  if (pluginRoot) return join(pluginRoot, SKILLS_DIR_NAME);
  return join(dirname(dirname(fileURLToPath(import.meta.url))), SKILLS_DIR_NAME);
}
function resolveSkillNameFromToolInput(toolInput) {
  if (!toolInput) return void 0;
  const indexed = toolInput;
  for (const inputKey of SKILL_NAME_INPUT_KEYS) {
    const value = indexed[inputKey];
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const skillName = value.trim().split(":").pop()?.replace(/^\//, "") ?? "";
    return SINGLE_PATH_SEGMENT.test(skillName) ? skillName : void 0;
  }
  return void 0;
}
function resolveSkillStagePaths(skillName, skillsRootDir) {
  const skillDir = join(skillsRootDir, skillName);
  const skillFile = join(skillDir, "SKILL.md");
  if (!existsSync(skillFile)) return [];
  const normalizedRoot = normalizeStagePath(skillsRootDir);
  const staysInsideSkillsTree = (candidate) => normalizeStagePath(candidate).startsWith(`${normalizedRoot}/`);
  const resolved = [];
  for (const declared of parseDeclaredStages(readFileSync(skillFile, "utf-8"))) {
    if (isAbsolute(declared)) continue;
    const stagePath = [resolve(skillDir, declared), resolve(skillsRootDir, declared)].find(
      (candidate) => staysInsideSkillsTree(candidate) && existsSync(candidate)
    );
    if (!stagePath) continue;
    const normalized = normalizeStagePath(stagePath);
    if (!resolved.includes(normalized)) resolved.push(normalized);
  }
  return resolved;
}
function applySkillInvocation(state, skillName, stagePaths) {
  const merged = [...state.mandatoryStages ?? []];
  for (const stagePath of stagePaths) if (!merged.includes(stagePath)) merged.push(stagePath);
  if (state.lastInvokedSkillName === skillName && merged.length === (state.mandatoryStages?.length ?? 0)) {
    return state;
  }
  return { ...state, lastInvokedSkillName: skillName, mandatoryStages: merged };
}
function applyStageRead(state, filePath) {
  const stagePath = normalizeStagePath(filePath);
  if ((state.stagesRead ?? []).includes(stagePath)) return state;
  return { ...state, stagesRead: [...state.stagesRead ?? [], stagePath] };
}
function unreadMandatoryStages(state) {
  const read = new Set(state.stagesRead ?? []);
  return (state.mandatoryStages ?? []).filter((stagePath) => !read.has(stagePath));
}
function isStageSkipMarker(command) {
  return STAGE_SKIP_MARKER.test(command);
}
function applyStageSkip(state, skipped) {
  if (!skipped || state.stageSkipped === true) return state;
  return { ...state, stageSkipped: true };
}
function stageGateDecision(state, unreadStagePaths, maxBlocks = MAX_STAGE_BLOCKS) {
  const blockCount = state.stageBlockCount ?? 0;
  if (state.stageSkipped === true || unreadStagePaths.length === 0) {
    return { action: "none" /* None */, blockCount, unread: unreadStagePaths };
  }
  if (blockCount >= maxBlocks) {
    return { action: "release" /* Release */, blockCount, unread: unreadStagePaths };
  }
  return { action: "block" /* Block */, blockCount: blockCount + 1, unread: unreadStagePaths };
}

// src/guardrails/preExecutionClassification.ts
var CLASSIFICATION_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_CLASSIFY_SKIP\b/;
function detectClassifiedTestCaseId(input2) {
  if (!MUGGLE_EVENT_EMIT_TOOL.test(input2.tool_name ?? "")) return void 0;
  if (input2.tool_input?.eventType !== PRE_EXECUTION_CLASSIFICATION_EVENT) return void 0;
  return input2.tool_input?.testCaseId ?? ANY_TEST_CASE;
}
function applyClassifiedTestCase(state, testCaseId) {
  if ((state.classifiedTestCaseIds ?? []).includes(testCaseId)) return state;
  return { ...state, classifiedTestCaseIds: [...state.classifiedTestCaseIds ?? [], testCaseId] };
}
function resolveExecutionTargetTestCaseId(input2) {
  if (!MUGGLE_EXECUTION_TOOL.test(input2.tool_name ?? "")) return void 0;
  return input2.tool_input?.testCase?.id ?? input2.tool_input?.testScript?.testCaseId;
}
function isClassificationSkipMarker(command) {
  return CLASSIFICATION_SKIP_MARKER.test(command);
}
function applyClassificationSkip(state, skipped) {
  if (!skipped || state.classificationSkipped === true) return state;
  return { ...state, classificationSkipped: true };
}
function classificationGateDecision(state, input2) {
  if (state.lastInvokedSkillName !== MUGGLE_TEST_SKILL_NAME) return { deny: false };
  if (state.classificationSkipped === true) return { deny: false };
  const testCaseId = resolveExecutionTargetTestCaseId(input2);
  if (!testCaseId) return { deny: false };
  const classified = state.classifiedTestCaseIds ?? [];
  if (classified.includes(ANY_TEST_CASE) || classified.includes(testCaseId)) return { deny: false };
  return { deny: true, testCaseId };
}

// src/guardrails/debugPath.ts
var DEBUG_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_DEBUG_SKIP\b/;
var serialize = (input2) => `${JSON.stringify(input2.tool_input ?? {})}
${JSON.stringify(input2.tool_response ?? {})}`;
function renderedResult(toolResponse) {
  const rendered = [];
  const collect = (value) => {
    if (typeof value === "string") rendered.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(toolResponse);
  return rendered.join("\n");
}
function detectFailedRunId(input2) {
  if (!MUGGLE_EXECUTION_TOOL.test(input2.tool_name ?? "")) return void 0;
  const rendered = renderedResult(input2.tool_response);
  const status = MUGGLE_RUN_STATUS_LINE.exec(rendered)?.[1];
  if (!status || status.toLowerCase() === MUGGLE_RUN_PASSED_STATUS) return void 0;
  return MUGGLE_RUN_ID_LINE.exec(rendered)?.[1];
}
function applyFailedRun(state, runId) {
  if ((state.failedRuns ?? []).includes(runId)) return state;
  return { ...state, failedRuns: [...state.failedRuns ?? [], runId] };
}
function detectDebugEvidenceRunIds(input2, owedRunIds) {
  const toolName = input2.tool_name ?? "";
  const isDiagnosisEmit = MUGGLE_EVENT_EMIT_TOOL.test(toolName) && FAILURE_DIAGNOSIS_EVENT.test(input2.tool_input?.eventType ?? "");
  if (!isDiagnosisEmit && !MUGGLE_FEEDBACK_CREATE_TOOL.test(toolName)) return [];
  const payload = serialize(input2);
  return owedRunIds.filter((runId) => payload.includes(runId));
}
function applyDebugEvidence(state, runIds) {
  const debugged = [...state.debuggedRuns ?? []];
  for (const runId of runIds) if (!debugged.includes(runId)) debugged.push(runId);
  if (debugged.length === (state.debuggedRuns ?? []).length) return state;
  return { ...state, debuggedRuns: debugged };
}
function isDebugSkipMarker(command) {
  return DEBUG_SKIP_MARKER.test(command);
}
function applyDebugSkip(state, command) {
  if (!isDebugSkipMarker(command)) return state;
  const namedRuns = (state.failedRuns ?? []).filter((runId) => command.includes(runId));
  if (namedRuns.length > 0) return applyDebugEvidence(state, namedRuns);
  if (state.debugSkipped === true) return state;
  return { ...state, debugSkipped: true };
}
function undebuggedFailedRuns(state) {
  const debugged = new Set(state.debuggedRuns ?? []);
  return (state.failedRuns ?? []).filter((runId) => !debugged.has(runId));
}
function debugGateDecision(state, maxBlocks = MAX_DEBUG_BLOCKS) {
  const blockCount = state.debugBlockCount ?? 0;
  const undebugged = undebuggedFailedRuns(state);
  if (state.debugSkipped === true || undebugged.length === 0) {
    return { action: "none" /* None */, blockCount, undebugged };
  }
  if (blockCount >= maxBlocks) {
    return { action: "release" /* Release */, blockCount, undebugged };
  }
  return { action: "block" /* Block */, blockCount: blockCount + 1, undebugged };
}

// src/guardrails/testsGreen.ts
var TEST_CMD = /\b(pnpm|npm|yarn)\s+(run\s+)?test\b|\b(jest|vitest|pytest)\b|\bgo\s+test\b|\bcargo\s+test\b/;
var FAIL = /\b\d+\s+failed\b|\bFAIL\b|✗/;
var E2E_TOOL = /muggle.*(execute|test-generation|replay)/i;
var E2E_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_E2E_SKIP\b/;
function isTestCommand(cmd) {
  return TEST_CMD.test(cmd);
}
function isE2ESkipMarker(cmd) {
  return E2E_SKIP_MARKER.test(cmd);
}
function testsPassed(input2) {
  const out = `${input2.tool_response?.stdout ?? ""}
${input2.tool_response?.stderr ?? ""}`;
  if (!out.trim()) return false;
  return !FAIL.test(out);
}
function isE2ERun(input2) {
  if (E2E_TOOL.test(input2.tool_name ?? "")) return true;
  return MUGGLE_SKILL_EMIT_TOOL.test(input2.tool_name ?? "") && input2.tool_input?.skillName === MUGGLE_TEST_SKILL_NAME;
}

// src/guardrails/shouldRunE2E.ts
var MAX_E2E_BLOCKS = 3;
function shouldRunE2E(state) {
  return state.unitTestsGreen === true && state.e2eRun !== true && state.e2eSkipped !== true;
}
function applyRecordedRun(state, run) {
  let next = state;
  if (run.unitTestPassed) {
    next = { ...next, unitTestsGreen: true, e2eRun: false };
  }
  if (run.e2eRan) {
    next = { ...next, e2eRun: true, e2eBlockCount: 0 };
  }
  if (run.e2eSkipped) {
    next = { ...next, e2eSkipped: true };
  }
  return next;
}
function e2eGateDecision(state, maxBlocks = MAX_E2E_BLOCKS) {
  const blockCount = state.e2eBlockCount ?? 0;
  if (!shouldRunE2E(state)) return { action: "none" /* None */, blockCount };
  if (blockCount >= maxBlocks) return { action: "release" /* Release */, blockCount };
  return { action: "block" /* Block */, blockCount: blockCount + 1 };
}
var WATCH_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_WATCH_SKIP\b/;
function isWatchSkipMarker(cmd) {
  return WATCH_SKIP_MARKER.test(cmd);
}
function applyWatchSkip(state, skipped) {
  if (!skipped || state.watchSkipped === true) return state;
  return { ...state, watchSkipped: true };
}
function findUntrackedHandledPrs(handledUrls, sessionsDirOverride) {
  if (handledUrls.length === 0) return [];
  const sessionsDir = join(homedir(), ".muggle-ai", "muggle-do", "sessions");
  if (!existsSync(sessionsDir)) return [...handledUrls];
  const trackedUrls = /* @__PURE__ */ new Set();
  for (const slug of readdirSync(sessionsDir)) {
    const prsFile = join(sessionsDir, slug, "prs.json");
    if (!existsSync(prsFile)) continue;
    let slotUrl;
    try {
      const parsed = JSON.parse(readFileSync(prsFile, "utf-8"));
      const entry = Array.isArray(parsed) ? parsed[0] : parsed;
      slotUrl = entry?.url;
    } catch {
      continue;
    }
    if (slotUrl) trackedUrls.add(slotUrl);
  }
  return handledUrls.filter((url) => !trackedUrls.has(url));
}
function watchGateDecision(state, untrackedPrUrls, maxBlocks = MAX_WATCH_BLOCKS) {
  const blockCount = state.watchBlockCount ?? 0;
  if (state.watchSkipped === true || untrackedPrUrls.length === 0) {
    return { action: "none" /* None */, blockCount, untracked: untrackedPrUrls };
  }
  if (blockCount >= maxBlocks) {
    return { action: "release" /* Release */, blockCount, untracked: untrackedPrUrls };
  }
  return {
    action: "block" /* Block */,
    blockCount: blockCount + 1,
    untracked: untrackedPrUrls
  };
}
var REPORT_SENTINEL = "muggle-pr-section";
var PR_PROSE_CMD = /\bgh\s+pr\s+(comment|create|edit)\b/;
var GH_API_CMD = /\bgh\s+api\b/;
var ISSUE_COMMENT_PATH = /\bissues\/comments\/\d+/;
var PATCH_METHOD = /(?:--method|-X)[=\s]+PATCH\b/;
var defaultFileReader = (path, cwd) => {
  try {
    const abs = isAbsolute(path) ? path : resolve(cwd ?? process.cwd(), path);
    if (!existsSync(abs)) return null;
    return readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
};
function unquote2(s) {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') || t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1);
  }
  return t;
}
function isCommentEditCommand(cmd) {
  return GH_API_CMD.test(cmd) && ISSUE_COMMENT_PATH.test(cmd) && PATCH_METHOD.test(cmd);
}
function isPrReportPostCommand(cmd) {
  return PR_PROSE_CMD.test(cmd) || isCommentEditCommand(cmd);
}
function collectPrPostText(cmd, cwd, read) {
  let text = cmd;
  for (const match of cmd.matchAll(/(?:--body-file|--input)[=\s]+("[^"]+"|'[^']+'|\S+)/g)) {
    const path = unquote2(match[1]);
    if (path && path !== "-") {
      const contents = read(path, cwd);
      if (contents) text += "\n" + contents;
    }
  }
  for (const match of cmd.matchAll(/jq\b[^|]*?("[^"]+\.json"|'[^']+\.json'|\S+\.json)/g)) {
    const contents = read(unquote2(match[1]), cwd);
    if (contents) text += "\n" + contents;
  }
  return text;
}

// src/guardrails/walkthroughPosted.ts
var WALKTHROUGH_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_WALKTHROUGH_SKIP\b/;
function isWalkthroughSkipMarker(cmd) {
  return WALKTHROUGH_SKIP_MARKER.test(cmd);
}
function detectWalkthroughPost(input2, read = defaultFileReader) {
  if (input2.tool_name !== "Bash") return false;
  const cmd = input2.tool_input?.command ?? "";
  if (!isPrReportPostCommand(cmd)) return false;
  return collectPrPostText(cmd, input2.cwd, read).includes(REPORT_SENTINEL);
}
function applyWalkthroughPosted(state, posted) {
  if (!posted || state.walkthroughPosted === true) return state;
  return { ...state, walkthroughPosted: true };
}
function applyWalkthroughSkip(state, skipped) {
  if (!skipped || state.walkthroughSkipped === true) return state;
  return { ...state, walkthroughSkipped: true };
}
function runGh(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf-8",
      timeout: GH_LOOKUP_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return null;
  }
}
var defaultPrWalkthroughLookup = {
  branchPrUrl: () => {
    const url = runGh(["pr", "view", "--json", "url", "-q", ".url"])?.trim();
    return url && url.startsWith("http") ? url : null;
  },
  // Scans the description as well as the comments: muggle-do embeds the
  // walkthrough in the body at PR-creation time, and a comments-only check
  // would report that PR as owing one it already carries.
  prCarriesWalkthrough: (prUrl) => {
    const rendered = runGh(["pr", "view", prUrl, "--json", "body,comments"]);
    if (rendered === null) return true;
    return rendered.includes(REPORT_SENTINEL);
  }
};
function scanForOwedWalkthroughs(state, lookup = defaultPrWalkthroughLookup) {
  const candidates = new Set(state.prsHandled);
  const branchPrUrl = lookup.branchPrUrl();
  if (branchPrUrl) candidates.add(branchPrUrl);
  const owed = [];
  const verified = [];
  for (const prUrl of candidates) {
    if (lookup.prCarriesWalkthrough(prUrl)) verified.push(prUrl);
    else owed.push(prUrl);
  }
  return { owed, verified };
}
function walkthroughGateDecision(state, owedPrUrls, maxBlocks = MAX_WALKTHROUGH_BLOCKS) {
  const blockCount = state.walkthroughBlockCount ?? 0;
  const alreadySettled = state.walkthroughPosted === true || state.walkthroughSkipped === true || state.e2eRun !== true;
  if (alreadySettled || owedPrUrls.length === 0) {
    return { action: "none" /* None */, blockCount, owed: owedPrUrls };
  }
  if (blockCount >= maxBlocks) {
    return { action: "release" /* Release */, blockCount, owed: owedPrUrls };
  }
  return { action: "block" /* Block */, blockCount: blockCount + 1, owed: owedPrUrls };
}

// src/guardrails/detectBuildIntent.ts
var BUILD = /\b(implement|build|add|create|write|fix|refactor|wire up|hook up|make (a|the|it)|change the)\b/i;
var DEVCYCLE = /\bresolve\b[^.?!]{0,40}\bconflicts?\b|\bget\b[^.?!]{0,40}\bpr\b[^.?!]{0,40}\b(green|merged?|passing)\b/i;
var QUESTION = /^\s*(why|what|how|when|where|who|is|are|does|do|can you (explain|tell)|explain)\b/i;
function detectBuildIntent(prompt) {
  const p = (prompt ?? "").trim();
  if (!p || p.startsWith("/")) return false;
  if (QUESTION.test(p)) return false;
  return BUILD.test(p) || DEVCYCLE.test(p);
}

// src/guardrails/reportGate.ts
function looksLikeE2EReport(text) {
  const t = text.toLowerCase();
  const statusEmojis = (text.match(/[✅❌⚠]/gu) ?? []).length;
  const tally = /\b\d+\s+(tests?\s+)?passed\b/.test(t) && /\b\d+\s+(tests?\s+)?(failed|inconclusive)\b/.test(t);
  const slashTally = /\bpassed\b\s*[/|]\s*\d*\s*(tests?\s*)?\bfailed\b/.test(t) || /\bfailed\b\s*[/|]\s*\d*\s*(tests?\s*)?\bpassed\b/.test(t);
  const resultsStructure = /acceptance results/.test(t) || tally || slashTally || statusEmojis >= 2;
  const muggleContext = /\bmuggle\b/.test(t) || /muggle-ai\.com/.test(t) || /\be2e\b/.test(t) || /\bacceptance\b/.test(t);
  return resultsStructure && muggleContext;
}
function evaluateReportPost(input2, read = defaultFileReader) {
  if (input2.tool_name !== "Bash") return { deny: false };
  const cmd = input2.tool_input?.command ?? "";
  if (!isPrReportPostCommand(cmd)) return { deny: false };
  const text = collectPrPostText(cmd, input2.cwd, read);
  if (text.includes(REPORT_SENTINEL)) return { deny: false };
  if (!looksLikeE2EReport(text)) return { deny: false };
  return {
    deny: true,
    reason: "Blocked: this looks like a hand-written E2E test report. Muggle requires the deterministic renderer \u2014 build the run's E2eReport JSON and pipe it through `muggle build-pr-section` (or invoke /muggle:muggle-pr-visual-walkthrough), then post that output. Never hand-write the walkthrough markdown."
  };
}

// src/guardrails/reviewThreadResolve.ts
function detectResolveCall(command) {
  if (!PROVIDER_API_INVOCATION.test(command)) return null;
  if (GITHUB_RESOLVE_THREAD_MUTATION.test(command)) return "github" /* GitHub */;
  if (GITLAB_RESOLVE_DISCUSSION_CALL.test(command)) return "gitlab" /* GitLab */;
  return null;
}
var RESOLVE_DENIAL = "Blocked: resolving a review thread is the reviewer's call, not the loop's. Reply to the thread instead \u2014 the `<!-- muggle-do:bot -->` marker on that reply is what retires it (a thread is actionable only while it is unresolved AND its newest comment is unmarked), so resolving buys no echo protection and costs the reviewer their record of what is still unverified. The loop has twice hidden threads carrying fixes that were partly wrong. If a thread genuinely warrants resolving, say so and let the reviewer close it in the UI; to nudge, run the resolve-reminder stage, which lists addressed-but-open threads without touching them.";
function evaluateReviewThreadResolve(input2) {
  if (input2.tool_name !== "Bash") return { deny: false };
  const provider = detectResolveCall(input2.tool_input?.command ?? "");
  if (!provider) return { deny: false };
  return { deny: true, reason: RESOLVE_DENIAL };
}

// src/guardrails/emit.ts
function envelope(eventName, context, host2) {
  if (!context) return "{}";
  if (host2 === "cursor") return JSON.stringify({ additional_context: context });
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: context }
  });
}
function blockStop(reason, host2) {
  if (!reason) return "{}";
  if (host2 === "cursor") return JSON.stringify({ additional_context: reason });
  return JSON.stringify({ decision: "block", reason });
}
function denyTool(reason, host2) {
  if (!reason) return "{}";
  if (host2 === "cursor") return JSON.stringify({ additional_context: reason });
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  });
}

// src/guardrails/cli.ts
function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf-8"));
  } catch {
    return {};
  }
}
var host = process.env.CURSOR_PLUGIN_ROOT ? "cursor" : "claude";
var sub = process.argv[2];
var input = readStdin();
var sessionId = input.session_id ?? "unknown";
function prOpened() {
  const url = detectPrOpened(input);
  if (!url) return "{}";
  if (readState(sessionId).prsHandled.includes(url)) return "{}";
  markPrHandled(sessionId, url);
  const ctx = `A pull request was just opened: ${url}
Per the autoWatchPR preference, a muggle-pr-followup watcher should handle its incoming reviews. If autoWatchPR=always, start it now by invoking /muggle:muggle-pr-followup with the PR URL; if =ask, offer it to the user; if =never, do nothing.`;
  return envelope("PostToolUse", ctx, host);
}
function prTerminal() {
  const reopenedPrNumber = detectPrReopened(input);
  if (reopenedPrNumber !== null) {
    const state2 = readState(sessionId);
    const next2 = applyPrReopened(state2, reopenedPrNumber);
    if (next2 !== state2) writeState(next2);
    return "{}";
  }
  const terminalEvent = detectPrTerminal(input);
  if (!terminalEvent) return "{}";
  const state = readState(sessionId);
  const next = applyPrTerminalDetected(state, terminalEvent.prNumber);
  if (next === state) return "{}";
  writeState(next);
  const ctx = `PR #${terminalEvent.prNumber} went terminal (${terminalEvent.verdict}). Run the post-merge handoff now: finalize the watcher slot, tear down per autoCleanup, then OFFER NEXT OPTIONS to the user (AskUserQuestion) \u2014 release, queued work, deferred items. The stop gate holds until the offer runs.`;
  return envelope("PostToolUse", ctx, host);
}
function offerRan() {
  if (input.tool_name !== "AskUserQuestion") return "{}";
  const state = readState(sessionId);
  const next = applyNextOptionsOffered(state);
  if (next !== state) writeState(next);
  return "{}";
}
function terminalGate() {
  const state = readState(sessionId);
  const decision = prTerminalGateDecision(state);
  if (decision.action !== "block" /* Block */) return "{}";
  state.terminalBlockCount = decision.blockCount;
  writeState(state);
  const pendingPrList = (state.terminalPending ?? []).map((prNumber) => `#${prNumber}`).join(", ");
  const reason = decision.blockCount === 1 ? `Do not end the turn yet. PR ${pendingPrList} went terminal (merged/closed) but the post-merge handoff has not run. Finalize the watcher slot, tear down per autoCleanup, then offer next options to the user via AskUserQuestion \u2014 release, queued work, deferred items. Only the AskUserQuestion offer clears this gate.` : `Post-merge handoff still owed for PR ${pendingPrList} (reminder ${decision.blockCount}/${MAX_PR_TERMINAL_BLOCKS}): finalize + tear down, then run the AskUserQuestion next-options offer.`;
  return blockStop(reason, host);
}
function recordTests() {
  const cmd = input.tool_input?.command ?? "";
  const state = readState(sessionId);
  const recorded = applyRecordedRun(state, {
    unitTestPassed: isTestCommand(cmd) && testsPassed(input),
    e2eRan: isE2ERun(input),
    e2eSkipped: isE2ESkipMarker(cmd)
  });
  const withWatchSkip = applyWatchSkip(recorded, isWatchSkipMarker(cmd));
  const withWalkthroughPost = applyWalkthroughPosted(withWatchSkip, detectWalkthroughPost(input));
  const withWalkthroughSkip = applyWalkthroughSkip(withWalkthroughPost, isWalkthroughSkipMarker(cmd));
  const failedRunId = detectFailedRunId(input);
  const next = failedRunId ? applyFailedRun(withWalkthroughSkip, failedRunId) : withWalkthroughSkip;
  if (next !== state) writeState(next);
  return "{}";
}
function skillStages() {
  const skillName = resolveSkillNameFromToolInput(input.tool_input);
  if (!skillName) return "{}";
  const state = readState(sessionId);
  const next = applySkillInvocation(
    state,
    skillName,
    resolveSkillStagePaths(skillName, resolvePluginSkillsRoot())
  );
  if (next !== state) writeState(next);
  const unread = unreadMandatoryStages(next);
  if (unread.length === 0) return "{}";
  const ctx = `The ${skillName} skill declares required reading: ${unread.map(stageLabel).join(", ")}. Read those files now, before working through the skill's steps \u2014 they carry mandatory steps SKILL.md only links to, and treating them as optional elaboration is how those steps get silently dropped. A Stop gate holds the turn open until they are opened.`;
  return envelope("PostToolUse", ctx, host);
}
function recordStageRead() {
  const filePath = input.tool_input?.file_path;
  if (!filePath) return "{}";
  const state = readState(sessionId);
  const next = applyStageRead(state, filePath);
  if (next !== state) writeState(next);
  return "{}";
}
function recordStageSignals() {
  const cmd = input.tool_input?.command ?? "";
  const state = readState(sessionId);
  const withStageSkip = applyStageSkip(state, isStageSkipMarker(cmd));
  const withClassificationSkip = applyClassificationSkip(
    withStageSkip,
    isClassificationSkipMarker(cmd)
  );
  const withDebugSkip = applyDebugSkip(withClassificationSkip, cmd);
  const classifiedTestCaseId = detectClassifiedTestCaseId(input);
  const withClassification = classifiedTestCaseId ? applyClassifiedTestCase(withDebugSkip, classifiedTestCaseId) : withDebugSkip;
  const next = applyDebugEvidence(
    withClassification,
    detectDebugEvidenceRunIds(input, undebuggedFailedRuns(withClassification))
  );
  if (next !== state) writeState(next);
  return "{}";
}
function classifyGate() {
  const decision = classificationGateDecision(readState(sessionId), input);
  if (!decision.deny) return "{}";
  const reason = `Test case ${decision.testCaseId} has no pre-execution classification this session. Run muggle-test Step 6f for it first: classify replay-vs-regen per _shared/failure-mode-handling.md \xA7A, then emit one muggle-local-telemetry-event-emit with eventType "pre-execution-classification" for this test case. That step is what calls muggle-remote-test-script-list, which is the only place this run learns the test case has never passed or has failed repeatedly \u2014 cheap now, ~5 minutes of browser time to rediscover after the fact. If this execution genuinely has no classification step (a single user-picked target), say why and run \`echo "MUGGLE_CLASSIFY_SKIP: <reason>"\` \u2014 that records the skip for the rest of the session.`;
  return denyTool(reason, host);
}
function stageGate() {
  const state = readState(sessionId);
  const decision = stageGateDecision(state, unreadMandatoryStages(state));
  if (decision.action !== "block" /* Block */) return "{}";
  state.stageBlockCount = decision.blockCount;
  writeState(state);
  const stageList = decision.unread.map(stageLabel).join(", ");
  const reason = decision.blockCount === 1 ? `Do not end the turn yet. A skill invoked this session declares mandatory stages that were never opened: ${stageList}. Read them and carry out what they require \u2014 they are steps, not background reading, and SKILL.md only links to them. If they genuinely do not apply to this run, say why and run \`echo "MUGGLE_STAGE_SKIP: <reason>"\` \u2014 that records the skip and keeps this gate quiet for the rest of the session.` : `Mandatory stages still unread (reminder ${decision.blockCount}/${MAX_STAGE_BLOCKS}): ${stageList}. Read them, or record a legitimate skip via \`echo "MUGGLE_STAGE_SKIP: <reason>"\`.`;
  return blockStop(reason, host);
}
function debugPathGate() {
  const state = readState(sessionId);
  const decision = debugGateDecision(state);
  if (decision.action !== "block" /* Block */) return "{}";
  state.debugBlockCount = decision.blockCount;
  writeState(state);
  const runList = decision.undebugged.join(", ");
  const reason = decision.blockCount === 1 ? `Do not end the turn yet. These runs failed and never went through the debug path: ${runList}. muggle-test Step 7C makes that mandatory \u2014 route each through _shared/debug-failed-run.md: gather the attempted steps and the failing screenshot, diagnose the bucket per _shared/failure-mode-handling.md \xA7B/\xA7C with its classified telemetry emit, and present the offer in which "give feedback & rerun" is always available. A summarized-and-dropped failure is the run a reviewer most needs to see. If a run genuinely cannot be debugged, run \`echo "MUGGLE_DEBUG_SKIP: <runId> <reason>"\` \u2014 that clears just that run.` : `Failed runs still owe the debug path (reminder ${decision.blockCount}/${MAX_DEBUG_BLOCKS}): ${runList}. Route each through _shared/debug-failed-run.md, or record a legitimate skip via \`echo "MUGGLE_DEBUG_SKIP: <runId> <reason>"\`.`;
  return blockStop(reason, host);
}
function e2eGate() {
  const state = readState(sessionId);
  const decision = e2eGateDecision(state);
  if (decision.action === "none" /* None */ || decision.action === "release" /* Release */) return "{}";
  state.e2eBlockCount = decision.blockCount;
  writeState(state);
  const reason = decision.blockCount === 1 ? `Do not end the turn yet. Unit tests passed this session but no E2E acceptance run has happened. Per the autoE2ETest preference (default: always), run change-driven E2E now via /muggle:muggle-test, then finish. If E2E genuinely cannot run here (no app to drive, services down, no PR), tell the user why and run \`echo "MUGGLE_E2E_SKIP: <reason>"\` \u2014 that records the skip and keeps this gate quiet for the rest of the session.` : `E2E acceptance run still owed (reminder ${decision.blockCount}/${MAX_E2E_BLOCKS}): run /muggle:muggle-test, or record a legitimate skip via \`echo "MUGGLE_E2E_SKIP: <reason>"\`.`;
  return blockStop(reason, host);
}
function watchGate() {
  const state = readState(sessionId);
  const untrackedPrUrls = findUntrackedHandledPrs(state.prsHandled);
  const decision = watchGateDecision(state, untrackedPrUrls);
  if (decision.action === "none" /* None */ || decision.action === "release" /* Release */) {
    return "{}";
  }
  state.watchBlockCount = decision.blockCount;
  writeState(state);
  const prList = decision.untracked.join(", ");
  const reason = decision.blockCount === 1 ? `Do not end the turn yet. A PR was opened this session but no muggle-do session slot tracks it: ${prList}. Seed the slot and hand off per muggle-do Stage 8 \u2014 /muggle:muggle-pr-followup ${decision.untracked[0]} does both. Seeding is what matters: once a slot exists, reconcile arms it at the next session start and finalizes it when the PR goes terminal, so an unarmed slot is fine but no slot means nothing ever picks this PR up. If it genuinely should not be tracked (autoWatchPR=never, handed off elsewhere), tell the user why and run \`echo "MUGGLE_WATCH_SKIP: <reason>"\` \u2014 that records the skip and keeps this gate quiet for the rest of the session.` : `PR hand-off still owed for ${prList} (reminder ${decision.blockCount}/${MAX_WATCH_BLOCKS}): seed a slot via /muggle:muggle-pr-followup, or record a legitimate skip via \`echo "MUGGLE_WATCH_SKIP: <reason>"\`.`;
  return blockStop(reason, host);
}
function walkthroughGate() {
  const state = readState(sessionId);
  if (state.e2eRun !== true || state.walkthroughPosted === true || state.walkthroughSkipped === true) {
    return "{}";
  }
  const scan = scanForOwedWalkthroughs(state);
  if (scan.owed.length === 0) {
    if (scan.verified.length > 0) writeState({ ...state, walkthroughPosted: true });
    return "{}";
  }
  const decision = walkthroughGateDecision(state, scan.owed);
  if (decision.action !== "block" /* Block */) return "{}";
  state.walkthroughBlockCount = decision.blockCount;
  writeState(state);
  const prList = decision.owed.join(", ");
  const reason = decision.blockCount === 1 ? `Do not end the turn yet. An E2E acceptance run happened this session but no visual walkthrough has reached ${prList}. Per the postPRVisualWalkthrough preference (default: always), post it now via /muggle:muggle-pr-visual-walkthrough \u2014 include the failed runs, which are the ones reviewers most need to see. If this result genuinely should not be posted (postPRVisualWalkthrough=never, someone else's PR, nothing renderable), tell the user why and run \`echo "MUGGLE_WALKTHROUGH_SKIP: <reason>"\` \u2014 that records the skip and keeps this gate quiet for the rest of the session.` : `Walkthrough still owed for ${prList} (reminder ${decision.blockCount}/${MAX_WALKTHROUGH_BLOCKS}): post via /muggle:muggle-pr-visual-walkthrough, or record a legitimate skip via \`echo "MUGGLE_WALKTHROUGH_SKIP: <reason>"\`.`;
  return blockStop(reason, host);
}
function reportGate() {
  const reportPostVerdict = evaluateReportPost(input);
  if (!reportPostVerdict.deny || !reportPostVerdict.reason) return "{}";
  return denyTool(reportPostVerdict.reason, host);
}
function resolveGate() {
  const resolveVerdict = evaluateReviewThreadResolve(input);
  if (!resolveVerdict.deny || !resolveVerdict.reason) return "{}";
  return denyTool(resolveVerdict.reason, host);
}
function buildRouter() {
  if (!detectBuildIntent(input.prompt ?? "")) return "{}";
  const state = readState(sessionId);
  if (state.buildIntentRouted) return "{}";
  state.buildIntentRouted = true;
  writeState(state);
  const ctx = `This looks like a build/implement/fix request. Per the autoRouteBuildToMuggleDo preference, route it through /muggle-do \u2014 which runs requirements \u2192 build (delegated to superpowers' design\u2192plan\u2192review) \u2192 impact \u2192 unit tests \u2192 E2E \u2192 PR \u2192 watcher. If autoRouteBuildToMuggleDo=always, enter that flow; if =ask, offer it; if =never, proceed normally.`;
  return envelope("UserPromptSubmit", ctx, host);
}
var handlers = {
  "pr-opened": prOpened,
  "pr-terminal": prTerminal,
  "offer-ran": offerRan,
  "record-tests": recordTests,
  "e2e-gate": e2eGate,
  "terminal-gate": terminalGate,
  "watch-gate": watchGate,
  "walkthrough-gate": walkthroughGate,
  "report-gate": reportGate,
  "resolve-gate": resolveGate,
  "build-router": buildRouter,
  "skill-stages": skillStages,
  "record-stage-read": recordStageRead,
  "record-stage-signals": recordStageSignals,
  "classify-gate": classifyGate,
  "stage-gate": stageGate,
  "debug-path-gate": debugPathGate
};
process.stdout.write((handlers[sub] ?? (() => "{}"))());
