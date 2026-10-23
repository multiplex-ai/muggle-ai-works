import { readFileSync, existsSync, readdirSync, mkdirSync, statSync, writeFileSync, renameSync, openSync, writeSync, closeSync, unlinkSync } from 'fs';
import { join, basename, isAbsolute, resolve, dirname } from 'path';
import { homedir, hostname } from 'os';
import { execFileSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

// src/guardrails/cli.ts

// src/guardrails/constants.ts
var GH_PR_MERGED_LINE = /\b(?:Merged|Squashed and merged|Rebased and merged) pull request [\w./-]*#(\d+)/;
var GH_PR_CLOSED_LINE = /\bClosed pull request [\w./-]*#(\d+)/;
var GH_PR_REOPENED_LINE = /\bReopened pull request [\w./-]*#(\d+)/;
var PR_MONITOR_TERMINAL_LINE = /\bTERMINAL pr=(\d+)(?: state=|: )(MERGED|CLOSED)\b/;
var MAX_PR_TERMINAL_BLOCKS = 3;
var SHELL_TOOL_NAMES = ["Bash", "PowerShell"];
var HOOK_HOST_ENV_VAR = "MUGGLE_HOOK_HOST";
var NEXT_OPTIONS_OFFER_TOOL_NAMES = ["AskUserQuestion", "request_user_input"];
var FILE_PRINTING_PROGRAMS = [
  "cat",
  "sed",
  "head",
  "tail",
  "nl",
  "less",
  "more",
  "bat",
  "batcat",
  "awk",
  "get-content",
  "gc",
  "type"
];
var MAX_WATCH_BLOCKS = 3;
var WATCH_HEARTBEAT_STALE_MS = 15 * 6e4;
var TERMINAL_SLOT_PR_STATES = ["merged", "closed"];
var STOPPED_SLOT_SUFFIX = ".stopped";
var MAX_BUILD_BLOCKS = 3;
var MAX_WALKTHROUGH_BLOCKS = 3;
var GH_LOOKUP_TIMEOUT_MS = 1e4;
function mcpToolNamePattern(hyphenatedSource) {
  return new RegExp(hyphenatedSource.replaceAll("-", "[-_]"), "i");
}
var MUGGLE_SKILL_EMIT_TOOL = mcpToolNamePattern("muggle-local-telemetry-skill-emit");
var MUGGLE_TEST_SKILL_NAME = "muggle-test";
var MANDATORY_STAGES_FRONTMATTER_KEY = "mandatoryStages";
var SKILL_NAME_INPUT_KEYS = ["skill", "skillName", "name", "command"];
var MAX_STAGE_BLOCKS = 3;
var MAX_DEBUG_BLOCKS = 3;
var ANY_TEST_CASE = "*";
var MUGGLE_EXECUTION_TOOL = mcpToolNamePattern("muggle-local-(execute-test-generation|execute-replay)");
var MUGGLE_EVENT_EMIT_TOOL = mcpToolNamePattern("muggle-local-telemetry-event-emit");
var MUGGLE_FEEDBACK_CREATE_TOOL = mcpToolNamePattern("muggle-remote-user-feedback-create");
var PRE_EXECUTION_CLASSIFICATION_EVENT = "pre-execution-classification";
var FAILURE_DIAGNOSIS_EVENT = /-failure-(classified|resolved)$/;
var MUGGLE_RUN_ID_LINE = /\*\*Run ID:\*\*\s*([^\s*]+)/;
var MUGGLE_RUN_STATUS_LINE = /\*\*Status:\*\*\s*([A-Za-z_]+)/;
var MUGGLE_RUN_PASSED_STATUS = "passed";
var GITHUB_RESOLVE_THREAD_MUTATION = /\bresolveReviewThread\b/;
var GITLAB_RESOLVE_DISCUSSION_CALL = /discussions\/[^\s"']*[?&]resolved=true/i;
var PROVIDER_API_INVOCATION = /\b(?:gh|glab)\s+api\b/;
var LOOP_REPLY_MARKER = "<!-- muggle-do:bot -->";
var REVIEW_THREAD_FETCH_COMMAND = /reviewThreads|merge_requests\/\d+\/discussions/;
var THREADED_REPLY_TARGET = /pulls\/\d+\/comments\/(\d+)\/replies|discussions\/([\w-]+)\/notes/g;
var MAX_REPLY_BLOCKS = 3;
var CAPABILITY_CLAIM_TRANSCRIPT_TAIL_BYTES = 64e3;
var SESSION_STATE_LOCK_WAIT_MS = 250;
var LOCK_POLL_INTERVAL_MS = 10;
var CALL_FAILURE_SIGNALS = [
  /\bgh:\s/,
  /\bglab:\s/,
  /\bHTTP\s(?:4|5)\d\d\b/,
  /"status"\s*:\s*"?(?:4|5)\d\d/,
  /"isError"\s*:\s*true/
];
var FORGE_TERMINAL_CMD = /\b(?:gh\s+pr\s+(?:merge|close|reopen)|glab\s+mr\s+(?:merge|close|reopen))\b/;
var WATCH_TERMINAL_CMD = /pr-watch-(?:loop|arm)\.sh/;
var MERGED_GATE_OUTPUT_SEPARATOR = "\n\n";
var GITHUB_PR_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/;
var GITLAB_MR_URL = /https?:\/\/[^/\s]+\/[^\s]+\/-\/merge_requests\/\d+/;
var SUBAGENT_DISPATCH_TOOL_NAMES = ["Agent", "Task"];
var ACCEPTANCE_TESTER_SUBAGENT_TYPE = /(?:^|:)acceptance-tester$/;
var ACCEPTANCE_REPORT_MARKERS = ["## Test Summary", "**Overall:**"];
var DELEGATED_E2E_WINDOW_MS = 60 * 6e4;

// src/guardrails/store/fileLock.ts
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function recordedHolder(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf-8"));
  } catch {
    return void 0;
  }
}
function breakLockIfHolderIsDead(lockPath) {
  const holder = recordedHolder(lockPath);
  if (!holder) return;
  if (holder.host !== hostname() || isProcessAlive(holder.pid)) return;
  try {
    unlinkSync(lockPath);
  } catch {
    return;
  }
}
function pauseBetweenAttempts() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_POLL_INTERVAL_MS);
}
function withFileLock(lockPath, waitMs, run) {
  const deadline = Date.now() + waitMs;
  for (; ; ) {
    let lockFileDescriptor;
    try {
      lockFileDescriptor = openSync(lockPath, "wx");
      writeSync(
        lockFileDescriptor,
        JSON.stringify({
          pid: process.pid,
          host: hostname(),
          acquiredAt: (/* @__PURE__ */ new Date()).toISOString()
        })
      );
    } catch {
      breakLockIfHolderIsDead(lockPath);
      if (Date.now() >= deadline) return void 0;
      pauseBetweenAttempts();
      continue;
    }
    try {
      return run();
    } finally {
      closeSync(lockFileDescriptor);
      try {
        unlinkSync(lockPath);
      } catch {
      }
    }
  }
}

// src/guardrails/sessionState.ts
var baseDir = (override) => override ?? join(homedir(), ".muggle-ai", "guardrails");
var fileFor = (sessionId2, override, suffix = ".json") => join(baseDir(override), `${sessionId2.replace(/[^A-Za-z0-9_-]/g, "_")}${suffix}`);
var WALKTHROUGH_SCAN_SUFFIX = ".walkthrough-scan.json";
var PR_STATE_SCAN_SUFFIX = ".pr-state-scan.json";
function writeAtomically(target, contents, dirOverride) {
  mkdirSync(baseDir(dirOverride), { recursive: true });
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, JSON.stringify(contents, null, 2));
  renameSync(staging, target);
}
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
  writeAtomically(fileFor(state.sessionId, dirOverride), state, dirOverride);
}
function readWalkthroughScan(sessionId2, dirOverride) {
  try {
    return JSON.parse(readFileSync(fileFor(sessionId2, dirOverride, WALKTHROUGH_SCAN_SUFFIX), "utf-8"));
  } catch {
    return null;
  }
}
function writeWalkthroughScan(sessionId2, scan, dirOverride) {
  writeAtomically(fileFor(sessionId2, dirOverride, WALKTHROUGH_SCAN_SUFFIX), scan, dirOverride);
}
function readPrStateScan(sessionId2, dirOverride) {
  try {
    const parsed = JSON.parse(readFileSync(fileFor(sessionId2, dirOverride, PR_STATE_SCAN_SUFFIX), "utf-8"));
    return parsed?.states && typeof parsed.states === "object" ? { states: parsed.states } : null;
  } catch {
    return null;
  }
}
function writePrStateScan(sessionId2, scan, dirOverride) {
  writeAtomically(fileFor(sessionId2, dirOverride, PR_STATE_SCAN_SUFFIX), scan, dirOverride);
}
function commitState(sessionId2, mutate, dirOverride) {
  mkdirSync(baseDir(dirOverride), { recursive: true });
  return withFileLock(`${fileFor(sessionId2, dirOverride)}.lock`, SESSION_STATE_LOCK_WAIT_MS, () => {
    const current = readState(sessionId2, dirOverride);
    const next = mutate(current);
    if (next === current) return current;
    const committed = { ...next, generation: (current.generation ?? 0) + 1 };
    writeState(committed, dirOverride);
    return committed;
  });
}
function updateState(sessionId2, mutate, dirOverride) {
  return commitState(sessionId2, mutate, dirOverride) !== void 0;
}
function markPrHandled(sessionId2, prUrl, dirOverride) {
  const state = readState(sessionId2, dirOverride);
  if (!state.prsHandled.includes(prUrl)) state.prsHandled.push(prUrl);
  writeState(state, dirOverride);
}

// src/guardrails/types.ts
var GuardrailBackgroundJob = /* @__PURE__ */ ((GuardrailBackgroundJob2) => {
  GuardrailBackgroundJob2["ScanWalkthroughs"] = "scan-walkthroughs";
  GuardrailBackgroundJob2["ReserveWalkthroughComment"] = "reserve-walkthrough-comment";
  GuardrailBackgroundJob2["SettleWalkthroughSkipped"] = "settle-walkthrough-skipped";
  GuardrailBackgroundJob2["SettleWalkthroughUnreasoned"] = "settle-walkthrough-unreasoned";
  GuardrailBackgroundJob2["SettleWalkthroughNoAppLogicChange"] = "settle-walkthrough-no-app-logic-change";
  GuardrailBackgroundJob2["ScanWatchPrStates"] = "scan-watch-pr-states";
  return GuardrailBackgroundJob2;
})(GuardrailBackgroundJob || {});
var ProviderPrState = /* @__PURE__ */ ((ProviderPrState2) => {
  ProviderPrState2["Open"] = "OPEN";
  ProviderPrState2["Merged"] = "MERGED";
  ProviderPrState2["Closed"] = "CLOSED";
  ProviderPrState2["Unreachable"] = "UNREACHABLE";
  return ProviderPrState2;
})(ProviderPrState || {});

// src/guardrails/backgroundJob.ts
function isBackgroundJob(subcommand) {
  return Object.values(GuardrailBackgroundJob).includes(subcommand);
}
function startBackgroundJob(job, jobArgs2, cwd) {
  try {
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1], job, ...jobArgs2], {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.on("error", () => void 0);
    child.unref();
  } catch {
    return;
  }
}

// src/guardrails/shellTool.ts
function isShellToolCall(input2) {
  return SHELL_TOOL_NAMES.includes(input2.tool_name ?? "");
}

// src/guardrails/prOpened.ts
var CREATE_CMD = /\bgh\s+pr\s+(create|ready)\b/;
var MR_CREATE_CMD = /\bglab\s+mr\s+create\b|\bglab\s+mr\s+update\b.*--ready\b/;
function detectPrOpened(input2) {
  if (!isShellToolCall(input2)) return null;
  const cmd = input2.tool_input?.command ?? "";
  if (!CREATE_CMD.test(cmd) && !MR_CREATE_CMD.test(cmd)) return null;
  const out = `${input2.tool_response?.stdout ?? ""}
${input2.tool_response?.output ?? ""}`;
  const m = out.match(GITHUB_PR_URL) ?? out.match(GITLAB_MR_URL);
  return m ? m[0] : null;
}

// src/guardrails/prTerminal.ts
function terminalProvenance(input2) {
  const command = input2.tool_input?.command;
  if (command === void 0) return { acceptsForgeLine: true, acceptsMonitorLine: true };
  return {
    acceptsForgeLine: FORGE_TERMINAL_CMD.test(command),
    acceptsMonitorLine: WATCH_TERMINAL_CMD.test(command)
  };
}
function detectPrTerminal(input2) {
  if (!isShellToolCall(input2) && input2.tool_name !== "Monitor") return null;
  const response = input2.tool_response;
  const provenance = terminalProvenance(input2);
  const haystack = [response?.stdout, response?.stderr, response?.output, response?.content].filter((part) => typeof part === "string").join("\n");
  const mergedMatch = provenance.acceptsForgeLine ? haystack.match(GH_PR_MERGED_LINE) : null;
  if (mergedMatch) {
    return { prNumber: Number(mergedMatch[1]), verdict: "merged" /* Merged */ };
  }
  const closedMatch = provenance.acceptsForgeLine ? haystack.match(GH_PR_CLOSED_LINE) : null;
  if (closedMatch) {
    return { prNumber: Number(closedMatch[1]), verdict: "closed" /* Closed */ };
  }
  const monitorMatch = provenance.acceptsMonitorLine ? haystack.match(PR_MONITOR_TERMINAL_LINE) : null;
  if (monitorMatch) {
    return {
      prNumber: Number(monitorMatch[1]),
      verdict: monitorMatch[2] === "MERGED" ? "merged" /* Merged */ : "closed" /* Closed */
    };
  }
  return null;
}
function detectPrReopened(input2) {
  if (!isShellToolCall(input2)) return null;
  if (!terminalProvenance(input2).acceptsForgeLine) return null;
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
function closingMessageAsksUser(closingMessage) {
  return typeof closingMessage === "string" && closingMessage.includes("?");
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

// src/guardrails/capabilityClaim.ts
var SENTENCE = /[^.!?\n]+/g;
var IMPOSSIBILITY = /\b(?:can(?:'|’)?t|cannot|can not|could ?n(?:'|’)?t|unable to|no way to|not able to|impossible|infeasible|untestable|unverifiable|not testable|blocked from|no (?:local )?(?:mail|email|smtp) path)\b/i;
var MUGGLE_CLEARS = /\b(?:magic[- ]?link|sign[- ]?in link|login link|email link|one[- ]time (?:code|password)|otp|verification (?:code|link|email|mail)|email verification|confirmation (?:code|link|email|mail)|2fa|two[- ]factor|password reset|reset link|inbox|mailbox|mailhog|mailpit|mailtrap|mailcatcher|smtp|transactional email|captcha|recaptcha|hcaptcha|log ?in|logged[- ]?in|sign ?in|signed[- ]in|authenticate|credential|sms|text message|texted code|authenticator app|google authenticator|authy|totp)/i;
var TESTING_CONTEXT = /\b(?:e2e|end[- ]to[- ]end|test(?:s|ed|ing|able)?|verif(?:y|ied|ication)|validat(?:e|ed|ion)|automat(?:e|ed|ion)|coverage|covered|exercis(?:e|ed)|reproduc(?:e|ed)|replay|scripts?|scripted|muggle|playwright|cypress|selenium)\b/i;
var GENUINELY_UNSUPPORTED = /\b(?:phone call|voice call|oauth|social (?:login|sign[- ]?in)|sign in with (?:google|github|apple|facebook)|no (?:phone )?number (?:is )?provisioned|no provisioned (?:phone )?number)\b/i;
function detectFalseCapabilityClaim(text) {
  const sentences = (text ?? "").match(SENTENCE) ?? [];
  return sentences.some(
    (sentence) => IMPOSSIBILITY.test(sentence) && MUGGLE_CLEARS.test(sentence) && TESTING_CONTEXT.test(sentence) && !GENUINELY_UNSUPPORTED.test(sentence)
  );
}
function lastAssistantText(transcriptJsonl) {
  const lines = (transcriptJsonl ?? "").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) continue;
    const prose = content.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
    if (prose) return prose;
  }
  return "";
}
var FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
var SEQUENCE_ENTRY = /^\s*-\s*(.+?)\s*$/;
var FLOW_LIST = /^\s*\[(.*)\]\s*$/;
var STAGE_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_STAGE_SKIP\b/;
var SKILLS_DIR_NAME = "skills";
var SKILLS_PATH_SEGMENT = `/${SKILLS_DIR_NAME}/`;
var SINGLE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;
var SHELL_COMMAND_SEPARATOR = /[;&|\n]/;
var SHELL_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
var SHELL_VARIABLE_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
var WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
var MARKDOWN_FILE = /\.md$/i;
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
function isSkillTreeMarkdown(filePath) {
  const normalized = normalizeStagePath(filePath);
  return normalized.includes(SKILLS_PATH_SEGMENT) && MARKDOWN_FILE.test(normalized);
}
function applyStageRead(state, filePath) {
  const stagePath = normalizeStagePath(filePath);
  if ((state.stagesRead ?? []).includes(stagePath)) return state;
  return { ...state, stagesRead: [...state.stagesRead ?? [], stagePath] };
}
var SHELL_ESCAPABLE_UNQUOTED = /* @__PURE__ */ new Set([" ", "	", "'", '"', "\\", "$", ";", "&", "|", "\n"]);
var SHELL_ESCAPABLE_DOUBLE_QUOTED = /* @__PURE__ */ new Set(['"', "\\", "$", "`"]);
function splitShellCommands(command) {
  const commands = [];
  let words = [];
  let word = "";
  let wordStarted = false;
  let quote = null;
  const endWord = () => {
    if (wordStarted) words.push(word);
    word = "";
    wordStarted = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    const nextCharacter = command[index + 1];
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else if (character === "\\" && quote === '"' && SHELL_ESCAPABLE_DOUBLE_QUOTED.has(nextCharacter)) {
        word += nextCharacter;
        index += 1;
      } else {
        word += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      wordStarted = true;
    } else if (character === "\\" && SHELL_ESCAPABLE_UNQUOTED.has(nextCharacter)) {
      word += nextCharacter;
      wordStarted = true;
      index += 1;
    } else if (SHELL_COMMAND_SEPARATOR.test(character)) {
      endCommand();
    } else if (/\s/.test(character)) {
      endWord();
    } else {
      word += character;
      wordStarted = true;
    }
  }
  endCommand();
  return commands;
}
function expandShellWord(word, variables) {
  const withHome = word === "~" || word.startsWith("~/") ? `${homedir()}${word.slice(1)}` : word;
  return withHome.replace(
    SHELL_VARIABLE_REFERENCE,
    (_reference, bracedName, bareName) => variables[bracedName ?? bareName ?? ""] ?? ""
  );
}
function resolveShellPath(path, workingDirectory) {
  return isAbsolute(path) || WINDOWS_ABSOLUTE_PATH.test(path) ? path : resolve(workingDirectory, path);
}
function detectShellStageReads(command, cwd, env = process.env) {
  const variables = { ...env };
  let workingDirectory = cwd ?? process.cwd();
  const readPaths = [];
  for (const words of splitShellCommands(command)) {
    let programIndex = 0;
    const assignments = [];
    for (; programIndex < words.length; programIndex += 1) {
      const assignment = SHELL_ASSIGNMENT.exec(words[programIndex]);
      if (!assignment) break;
      assignments.push([assignment[1], expandShellWord(assignment[2], variables)]);
    }
    const programWord = words[programIndex];
    if (programWord === void 0 || programWord === "export") {
      for (const word of words.slice(programIndex + 1)) {
        const exported = SHELL_ASSIGNMENT.exec(word);
        if (exported) assignments.push([exported[1], expandShellWord(exported[2], variables)]);
      }
      for (const [name, value] of assignments) variables[name] = value;
      continue;
    }
    const program = basename(programWord.replaceAll("\\", "/")).toLowerCase().replace(/\.exe$/, "");
    const argumentWords = words.slice(programIndex + 1).map((word) => expandShellWord(word, variables));
    if (program === "cd") {
      const target = argumentWords.find((word) => !word.startsWith("-"));
      if (target) workingDirectory = resolveShellPath(target, workingDirectory);
      continue;
    }
    if (!FILE_PRINTING_PROGRAMS.includes(program)) continue;
    for (const argument of argumentWords) {
      if (argument.startsWith("-") || !MARKDOWN_FILE.test(argument)) continue;
      const readPath = normalizeStagePath(resolveShellPath(argument, workingDirectory));
      if (isSkillTreeMarkdown(readPath) && !readPaths.includes(readPath)) readPaths.push(readPath);
    }
  }
  return readPaths;
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

// src/guardrails/callOutcome.ts
function renderedResponse(toolResponse) {
  const rendered = [];
  const collect = (value) => {
    if (typeof value === "string") rendered.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(toolResponse);
  return rendered.join("\n");
}
function callFailed(input2) {
  const rendered = renderedResponse(input2.tool_response);
  return CALL_FAILURE_SIGNALS.some((signal) => signal.test(rendered));
}

// src/guardrails/preExecutionClassification.ts
var CLASSIFICATION_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_CLASSIFY_SKIP\b/;
function detectClassifiedTestCaseId(input2) {
  if (!MUGGLE_EVENT_EMIT_TOOL.test(input2.tool_name ?? "")) return void 0;
  if (input2.tool_input?.eventType !== PRE_EXECUTION_CLASSIFICATION_EVENT) return void 0;
  if (callFailed(input2)) return void 0;
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

// src/guardrails/delegatedE2e.ts
function carriesAcceptanceReport(input2) {
  const response = JSON.stringify(input2.tool_response ?? "");
  return ACCEPTANCE_REPORT_MARKERS.some((marker) => response.includes(marker));
}
function quotedPrUrls(brief) {
  const githubPrUrls = [...brief.matchAll(new RegExp(GITHUB_PR_URL.source, "g"))];
  const gitlabMrUrls = [...brief.matchAll(new RegExp(GITLAB_MR_URL.source, "g"))];
  return [...new Set([...githubPrUrls, ...gitlabMrUrls].map((match) => match[0]))];
}
function detectBackgroundAcceptanceDispatch(input2) {
  if (!SUBAGENT_DISPATCH_TOOL_NAMES.includes(input2.tool_name ?? "")) return null;
  if (!ACCEPTANCE_TESTER_SUBAGENT_TYPE.test(input2.tool_input?.subagent_type ?? "")) return null;
  if (callFailed(input2) || carriesAcceptanceReport(input2)) return null;
  return quotedPrUrls(input2.tool_input?.prompt ?? "");
}
function liveDelegations(state, now) {
  return (state.e2eDelegations ?? []).filter((delegation) => now - delegation.dispatchedAt < DELEGATED_E2E_WINDOW_MS);
}
function applyE2eDelegation(state, delegation) {
  return { ...state, e2eDelegations: [...liveDelegations(state, delegation.dispatchedAt), delegation] };
}
function isE2eDelegationInFlight(state, now) {
  return liveDelegations(state, now).length > 0;
}
function withoutDelegatedPrs(prUrls, state, now) {
  const delegatedPrUrls = new Set(liveDelegations(state, now).flatMap((delegation) => delegation.prUrls));
  return prUrls.filter((prUrl) => !delegatedPrUrls.has(prUrl));
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
  if (callFailed(input2)) return [];
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
function debugGateDecision(state, maxBlocks = MAX_DEBUG_BLOCKS, now = Date.now()) {
  const blockCount = state.debugBlockCount ?? 0;
  const undebugged = undebuggedFailedRuns(state);
  if (state.debugSkipped === true || undebugged.length === 0 || isE2eDelegationInFlight(state, now)) {
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
function isTestCommand(cmd) {
  return TEST_CMD.test(cmd);
}
function testsPassed(input2) {
  const response = input2.tool_response;
  const out = `${response?.stdout ?? ""}
${response?.stderr ?? ""}
${response?.output ?? ""}`;
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
  const owed = state.unitTestsGreen === true || state.prsHandled.length > 0;
  return owed && state.e2eRun !== true && state.e2eSkipped !== true;
}
function applyRecordedRun(state, run) {
  let next = state;
  if (run.unitTestPassed) {
    next = { ...next, unitTestsGreen: true, e2eRun: false };
    if (next.e2eSkipCycleScoped === true) next = { ...next, e2eSkipped: false, e2eSkipCycleScoped: false };
  }
  if (run.e2eRan) {
    next = { ...next, e2eRun: true, e2eBlockCount: 0 };
  }
  if (run.e2eSkipped) {
    const isEnvironmentSkipHeld = next.e2eSkipped === true && next.e2eSkipCycleScoped !== true;
    next = { ...next, e2eSkipped: true, e2eSkipCycleScoped: !isEnvironmentSkipHeld && run.e2eSkipCycleScoped === true };
  }
  return next;
}
function e2eGateDecision(state, maxBlocks = MAX_E2E_BLOCKS, now = Date.now()) {
  const blockCount = state.e2eBlockCount ?? 0;
  if (!shouldRunE2E(state) || isE2eDelegationInFlight(state, now)) {
    return { action: "none" /* None */, blockCount };
  }
  if (blockCount >= maxBlocks) return { action: "release" /* Release */, blockCount };
  return { action: "block" /* Block */, blockCount: blockCount + 1 };
}

// src/hook-budget/constants.ts
var HOOK_CHILD_PROCESS_DEADLINE_MS = 600;

// src/hook-budget/childProcessBudget.ts
var childProcessDeadlineEpochMs = null;
function enforceHookChildProcessDeadline(gatesStartEpochMs = Date.now()) {
  childProcessDeadlineEpochMs = gatesStartEpochMs + HOOK_CHILD_PROCESS_DEADLINE_MS;
}
function boundedChildTimeoutMs(ceilingMs) {
  if (childProcessDeadlineEpochMs === null) return ceilingMs;
  const remainingMs = Math.floor(childProcessDeadlineEpochMs - Date.now());
  return remainingMs > 0 ? Math.min(ceilingMs, remainingMs) : null;
}

// src/pr-walkthrough/constants.ts
var REPORT_SENTINEL = "muggle-pr-section";
var WALKTHROUGH_SLOT_MARKER = "<!-- muggle-pr-walkthrough:v1 -->";
var WALKTHROUGH_SKIPPED_MARKER = "<!-- muggle-pr-walkthrough-status:skipped -->";
var WALKTHROUGH_COMMENT_HEADING = "### Muggle AI \u2014 PR visual walkthrough";
var REPORT_SENTINEL_TAG = new RegExp(`<!--\\s*${REPORT_SENTINEL}[^>]*-->\\s*`, "g");
var LAST_FULL_RUN_OPENING = "<details><summary>Last full E2E run on this PR</summary>";
var SHORT_SHA_LENGTH = 7;
var GH_COMMENT_TIMEOUT_MS = 1e4;

// src/pr-walkthrough/gh.ts
var GITHUB_PR_URL2 = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/;
var GH_CALLS_ENV = "MUGGLE_GUARDRAIL_GH_CALLS";
var defaultGhRunner = (args, input2) => {
  if (process.env[GH_CALLS_ENV] === "off") return null;
  const timeoutMs = boundedChildTimeoutMs(GH_COMMENT_TIMEOUT_MS);
  if (timeoutMs === null) return null;
  try {
    return execFileSync("gh", args, {
      encoding: "utf-8",
      input: input2,
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true
    });
  } catch {
    return null;
  }
};
function parsePrUrl(prUrl) {
  const parts = prUrl.match(GITHUB_PR_URL2);
  if (!parts) return null;
  return { repo: `${parts[1]}/${parts[2]}`, prNumber: Number(parts[3]) };
}
function listPrComments(pr, run) {
  let raw;
  try {
    raw = run(["api", "--paginate", `repos/${pr.repo}/issues/${pr.prNumber}/comments`]);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function readPrHeadSha(pr, run) {
  try {
    return run(["api", `repos/${pr.repo}/pulls/${pr.prNumber}`, "--jq", ".head.sha"])?.trim() || null;
  } catch {
    return null;
  }
}
function writeJson(args, payload, run) {
  try {
    return run(args, JSON.stringify(payload)) !== null;
  } catch {
    return false;
  }
}
function postPrComment(pr, body, run) {
  return writeJson(
    ["api", "--method", "POST", `repos/${pr.repo}/issues/${pr.prNumber}/comments`, "--input", "-"],
    { body },
    run
  );
}
function patchPrComment(pr, commentId, body, run) {
  return writeJson(
    ["api", "--method", "PATCH", `repos/${pr.repo}/issues/comments/${commentId}`, "--input", "-"],
    { body },
    run
  );
}

// src/guardrails/watchArmed.ts
var WATCH_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_WATCH_SKIP\b/;
function isWatchSkipMarker(cmd) {
  return WATCH_SKIP_MARKER.test(cmd);
}
function applyWatchSkip(state, skipped) {
  if (!skipped || state.watchSkipped === true) return state;
  return { ...state, watchSkipped: true };
}
function resolveWatchSlotStatus(evidence, nowMs, staleAfterMs = WATCH_HEARTBEAT_STALE_MS) {
  if (evidence.isStopped) return "stopped" /* Stopped */;
  const recordedState = evidence.recordedPrState?.toLowerCase() ?? "";
  if (evidence.isFinalized || TERMINAL_SLOT_PR_STATES.includes(recordedState)) {
    return "terminal" /* Terminal */;
  }
  const heartbeatAgeMs = evidence.heartbeatMtimeMs === void 0 ? Infinity : nowMs - evidence.heartbeatMtimeMs;
  return heartbeatAgeMs <= staleAfterMs ? "live" /* Live */ : "stale" /* Stale */;
}
function readHeartbeatMtimeMs(slotPath) {
  try {
    return statSync(join(slotPath, "watch-heartbeat")).mtimeMs;
  } catch {
    return void 0;
  }
}
function findUnwatchedHandledPrs(handledUrls, sessionsDirOverride) {
  if (handledUrls.length === 0) return [];
  const sessionsDir = join(homedir(), ".muggle-ai", "muggle-do", "sessions");
  let slugs;
  try {
    slugs = readdirSync(sessionsDir);
  } catch {
    return [...handledUrls];
  }
  const nowMs = Date.now();
  const watchedUrls = /* @__PURE__ */ new Set();
  for (const slug of slugs) {
    const slotPath = join(sessionsDir, slug);
    let slotPr;
    try {
      const parsed = JSON.parse(readFileSync(join(slotPath, "prs.json"), "utf-8"));
      slotPr = Array.isArray(parsed) ? parsed[0] : parsed;
    } catch {
      continue;
    }
    const slotUrl = slotPr?.url;
    if (typeof slotUrl !== "string" || !handledUrls.includes(slotUrl)) continue;
    const evidence = {
      isStopped: slug.endsWith(STOPPED_SLOT_SUFFIX),
      isFinalized: existsSync(join(slotPath, "result.md")),
      recordedPrState: typeof slotPr?.state === "string" ? slotPr.state : void 0,
      heartbeatMtimeMs: readHeartbeatMtimeMs(slotPath)
    };
    if (resolveWatchSlotStatus(evidence, nowMs) !== "stale" /* Stale */) watchedUrls.add(slotUrl);
  }
  return handledUrls.filter((url) => !watchedUrls.has(url));
}
function isTerminalThisSession(prUrl, state) {
  const prNumber = parsePrUrl(prUrl)?.prNumber;
  if (prNumber === void 0) return false;
  return (state.terminalPending ?? []).includes(prNumber) || (state.terminalHandled ?? []).includes(prNumber);
}
function isEndState(providerState) {
  return providerState === "MERGED" /* Merged */ || providerState === "CLOSED" /* Closed */;
}
function resolveOwedWatchPrs(unwatchedUrls, state, scan) {
  return unwatchedUrls.filter((prUrl) => {
    if (isTerminalThisSession(prUrl, state)) return false;
    const providerState = scan?.states[prUrl];
    return providerState === void 0 || providerState === "OPEN" /* Open */;
  });
}
function prsAwaitingStateScan(unwatchedUrls, state, scan) {
  return unwatchedUrls.filter(
    (prUrl) => !isTerminalThisSession(prUrl, state) && !isEndState(scan?.states[prUrl])
  );
}
function lookupProviderPrState(prUrl, run = defaultGhRunner) {
  if (!parsePrUrl(prUrl)) return null;
  const reportedState = run(["pr", "view", prUrl, "--json", "state", "-q", ".state"])?.trim();
  return Object.values(ProviderPrState).find(
    (providerState) => providerState === reportedState && providerState !== "UNREACHABLE" /* Unreachable */
  ) ?? "UNREACHABLE" /* Unreachable */;
}
function scanProviderPrStates(prUrls, lookup = lookupProviderPrState) {
  const states = {};
  for (const prUrl of prUrls) {
    const providerState = lookup(prUrl);
    if (providerState !== null) states[prUrl] = providerState;
  }
  return { states };
}
function watchGateDecision(state, unwatchedPrUrls, maxBlocks = MAX_WATCH_BLOCKS) {
  const blockCount = state.watchBlockCount ?? 0;
  if (state.watchSkipped === true || unwatchedPrUrls.length === 0) {
    return { action: "none" /* None */, blockCount, unwatched: unwatchedPrUrls };
  }
  if (blockCount >= maxBlocks) {
    return { action: "release" /* Release */, blockCount, unwatched: unwatchedPrUrls };
  }
  return {
    action: "block" /* Block */,
    blockCount: blockCount + 1,
    unwatched: unwatchedPrUrls
  };
}

// src/guardrails/buildFollowthrough.ts
var BUILD_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_BUILD_SKIP\b/;
function isBuildSkipMarker(cmd) {
  return BUILD_SKIP_MARKER.test(cmd);
}
function applyBuildSkip(state, skipped) {
  if (!skipped || state.buildSkipped === true) return state;
  return { ...state, buildSkipped: true };
}
function buildFollowthroughDecision(state, maxBlocks = MAX_BUILD_BLOCKS) {
  const blockCount = state.buildBlockCount ?? 0;
  const owed = state.buildIntentRouted === true && state.buildSkipped !== true && state.prsHandled.length === 0;
  if (!owed) return { action: "none" /* None */, blockCount };
  if (blockCount >= maxBlocks) {
    return { action: "release" /* Release */, blockCount };
  }
  return { action: "block" /* Block */, blockCount: blockCount + 1 };
}
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
  if (!isShellToolCall(input2)) return false;
  const cmd = input2.tool_input?.command ?? "";
  if (!isPrReportPostCommand(cmd)) return false;
  if (callFailed(input2)) return false;
  return collectPrPostText(cmd, input2.cwd, read).includes(REPORT_SENTINEL);
}
function applyWalkthroughPosted(state, posted, postedAt) {
  if (!posted) return state;
  return { ...state, walkthroughPostedAt: postedAt };
}
function applyWalkthroughSkip(state, skipped) {
  if (!skipped || state.walkthroughSkipped === true) return state;
  return { ...state, walkthroughSkipped: true };
}
function runGh(args) {
  const timeoutMs = boundedChildTimeoutMs(GH_LOOKUP_TIMEOUT_MS);
  if (timeoutMs === null) return null;
  try {
    return execFileSync("gh", args, {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
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
  const verified2 = [];
  for (const prUrl of candidates) {
    if (lookup.prCarriesWalkthrough(prUrl)) verified2.push(prUrl);
    else owed.push(prUrl);
  }
  return { owed, verified: verified2 };
}
function isWalkthroughGateArmed(state) {
  return state.e2eRun === true && state.walkthroughsVerified !== true && state.walkthroughSkipped !== true;
}
function isWalkthroughScanCurrent(scan, state) {
  const scanned = new Set(scan.prsHandled);
  const coversHandledPrs = scanned.size === new Set(state.prsHandled).size && state.prsHandled.every((prUrl) => scanned.has(prUrl));
  const postedAt = state.walkthroughPostedAt;
  const followsLastPost = postedAt === void 0 || (scan.startedAt ?? 0) >= postedAt;
  return coversHandledPrs && followsLastPost;
}
function applyPrOpenedToWalkthroughs(state) {
  return state.walkthroughsVerified === true ? { ...state, walkthroughsVerified: false } : state;
}
function walkthroughGateDecision(state, owedPrUrls, maxBlocks = MAX_WALKTHROUGH_BLOCKS) {
  const blockCount = state.walkthroughBlockCount ?? 0;
  const alreadySettled = state.walkthroughsVerified === true || state.walkthroughSkipped === true || state.e2eRun !== true;
  if (alreadySettled || owedPrUrls.length === 0) {
    return { action: "none" /* None */, blockCount, owed: owedPrUrls };
  }
  if (blockCount >= maxBlocks) {
    return { action: "release" /* Release */, blockCount, owed: owedPrUrls };
  }
  return { action: "block" /* Block */, blockCount: blockCount + 1, owed: owedPrUrls };
}

// src/e2e-skip/types.ts
var E2eSkipCode = /* @__PURE__ */ ((E2eSkipCode3) => {
  E2eSkipCode3["NoWebSurface"] = "NO_WEB_SURFACE";
  E2eSkipCode3["DevServerUnreachable"] = "DEV_SERVER_UNREACHABLE";
  E2eSkipCode3["EmptyDiff"] = "EMPTY_DIFF";
  E2eSkipCode3["MuggleAuthDown"] = "MUGGLE_AUTH_DOWN";
  E2eSkipCode3["NoPr"] = "NO_PR";
  E2eSkipCode3["UserWaived"] = "USER_WAIVED";
  E2eSkipCode3["NoAppLogicChange"] = "NO_APP_LOGIC_CHANGE";
  return E2eSkipCode3;
})(E2eSkipCode || {});

// src/e2e-skip/constants.ts
var E2E_SKIP_DECLARATION = /^\s*echo\s+["']?MUGGLE_E2E_SKIP:(.*)$/;
var SKIP_CODE_TOKEN = /^[\s:]*([A-Za-z_]+)/;
var E2E_SKIP_CODES = Object.values(E2eSkipCode);
var NON_APP_PATH_SUMMARY = "docs, tests, lint/format config, or CI config";
var E2E_SKIP_CODE_CLAIMS = {
  ["NO_WEB_SURFACE" /* NoWebSurface */]: "the repo ships no web surface to drive",
  ["DEV_SERVER_UNREACHABLE" /* DevServerUnreachable */]: "the named dev server does not answer",
  ["EMPTY_DIFF" /* EmptyDiff */]: "the branch carries no diff against its base",
  ["MUGGLE_AUTH_DOWN" /* MuggleAuthDown */]: "the stored Muggle session is missing or expired",
  ["NO_PR" /* NoPr */]: "no pull request was handled this session",
  ["USER_WAIVED" /* UserWaived */]: "the user waived E2E in their own words",
  ["NO_APP_LOGIC_CHANGE" /* NoAppLogicChange */]: `every path changed since the named commit is ${NON_APP_PATH_SUMMARY}`
};
var CYCLE_SCOPED_SKIP_CODES = ["NO_APP_LOGIC_CHANGE" /* NoAppLogicChange */];
var PRE_CYCLE_SHA_TOKEN = /^([0-9a-f]{7,40})(?![0-9a-z_])/i;
var NON_APP_PATH_PATTERNS = [
  /\.(md|markdown|rst)$/i,
  /(^|\/)[^/]+\.(test|spec)\.[^/]+$/,
  /(^|\/)(__tests__|__snapshots__|__mocks__)\//,
  /(^|\/)test_[^/]+\.py$/,
  /(^|\/)[^/]+_test\.(py|go)$/,
  /^tests?\//,
  /(^|\/)\.(eslintrc|prettierrc|stylelintrc)(\.[a-z]+)?$/,
  /(^|\/)(eslint|prettier|stylelint)\.config\.[cm]?[jt]s$/,
  /(^|\/)\.(eslint|prettier|stylelint)ignore$/,
  /(^|\/)\.markdownlint[^/]*$/,
  /(^|\/)(biome\.jsonc?|\.editorconfig)$/,
  /^\.github\/workflows\//,
  /^\.gitlab-ci\.yml$/
];
var MAX_NAMED_APP_LOGIC_PATHS = 5;
var USER_WAIVE_PHRASE = "SKIP E2E";
var DEV_SERVER_PROBE_TIMEOUT_MS = 2e3;
var GIT_PROBE_TIMEOUT_MS = 5e3;
var WEB_SERVER_COMMAND = /\b(vite|next\s+(dev|start)|react-scripts|ng\s+serve|nuxt|astro\s+dev|remix\s+dev|webpack(-dev)?-server|http-server|serve\s+-s|gatsby\s+develop|vue-cli-service\s+serve)\b/;
var BROWSER_FRAMEWORK_PACKAGES = [
  "react-dom",
  "next",
  "vue",
  "svelte",
  "@angular/core",
  "nuxt",
  "astro",
  "@remix-run/react",
  "preact",
  "solid-js"
];
var WEB_SURFACE_CONFIG_FILES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "vite.config.js",
  "vite.config.ts",
  "index.html",
  "public/index.html"
];
var OAUTH_SESSION_FILE = /^oauth-session[\w.-]*\.json$/;
var MUGGLE_HOME_DIR_NAME = ".muggle-ai";

// src/e2e-skip/noAppLogicChange.ts
function parseNoAppLogicChangeDetail(detail) {
  const stated = detail.trim();
  const preCycleSha = stated.match(PRE_CYCLE_SHA_TOKEN)?.[1];
  if (!preCycleSha) return null;
  const reason = stated.slice(preCycleSha.length).replace(/^[\s:,;.-]+/, "").trim();
  return { preCycleSha, reason };
}
function isNonAppPath(repoRelativePath) {
  return NON_APP_PATH_PATTERNS.some((pattern) => pattern.test(repoRelativePath));
}

// src/pr-walkthrough/comment.ts
function renderReservedComment() {
  return `${WALKTHROUGH_SLOT_MARKER}
${WALKTHROUGH_COMMENT_HEADING}

_Awaiting the E2E acceptance run. Muggle edits this comment in place when the run finishes \u2014 or records why E2E does not apply to this change._`;
}
function renderSkippedComment(code, detail) {
  const stated = detail.trim();
  const qualifier = stated ? ` \u2014 ${stated}` : "";
  return `${WALKTHROUGH_SLOT_MARKER}
${WALKTHROUGH_SKIPPED_MARKER}
${WALKTHROUGH_COMMENT_HEADING}

**No E2E run.** Muggle verified \`${code}\` \u2014 ${E2E_SKIP_CODE_CLAIMS[code]}${qualifier}.`;
}
function renderUnreasonedSkipComment() {
  return `${WALKTHROUGH_SLOT_MARKER}
${WALKTHROUGH_SKIPPED_MARKER}
${WALKTHROUGH_COMMENT_HEADING}

**No E2E run, and no verified reason given.** The session ended still owing an acceptance run and cited no skip code that Muggle could verify. Treat this PR as unvalidated by E2E.`;
}
var shortSha = (sha) => sha.slice(0, SHORT_SHA_LENGTH);
function renderNoAppLogicChangeComment(declared, headSha, lastFullRun) {
  const cycleStart = declared.preCycleSha.toLowerCase();
  const head = headSha?.toLowerCase() ?? null;
  const isHeadPastCycleStart = head !== null && !head.startsWith(cycleStart) && !cycleStart.startsWith(head);
  const headline = isHeadPastCycleStart ? `**E2E skipped \u2014 no app-logic change in \`${shortSha(head)}\`.**` : `**E2E skipped \u2014 no app-logic change since \`${shortSha(cycleStart)}\`.**`;
  const qualifier = declared.reason ? ` \u2014 ${declared.reason}` : "";
  const evidence = lastFullRun ? `${LAST_FULL_RUN_OPENING}

${lastFullRun}

</details>` : "_No full E2E run is on record for this PR._";
  return `${WALKTHROUGH_SLOT_MARKER}
${WALKTHROUGH_SKIPPED_MARKER}
${WALKTHROUGH_COMMENT_HEADING}

${headline} Muggle verified \`${"NO_APP_LOGIC_CHANGE" /* NoAppLogicChange */}\` \u2014 every path changed since \`${shortSha(cycleStart)}\` is ${NON_APP_PATH_SUMMARY}${qualifier}.

` + evidence;
}
function lastFullRunOf(body) {
  const status = classifyComment(body);
  if (status === "reported" /* Reported */) return body.replace(REPORT_SENTINEL_TAG, "").trim();
  if (status !== "skipped" /* Skipped */) return null;
  const start = body.indexOf(LAST_FULL_RUN_OPENING);
  if (start === -1) return null;
  return body.slice(start + LAST_FULL_RUN_OPENING.length).replace(/\s*<\/details>\s*$/, "").trim();
}
function classifyComment(body) {
  if (body.includes(REPORT_SENTINEL)) return "reported" /* Reported */;
  if (!body.includes(WALKTHROUGH_SLOT_MARKER)) return "not-designated" /* NotDesignated */;
  if (body.includes(WALKTHROUGH_SKIPPED_MARKER)) return "skipped" /* Skipped */;
  return "pending" /* Pending */;
}

// src/pr-walkthrough/reserve.ts
function commentWithStatus(comments, status) {
  return comments.find((comment) => classifyComment(comment.body) === status);
}
function reserveComment(pr, comments, run) {
  const claimed = comments.some(
    (comment) => classifyComment(comment.body) !== "not-designated" /* NotDesignated */
  );
  if (claimed) return false;
  return postPrComment(pr, renderReservedComment(), run);
}
function reserveWalkthroughComment(prUrl, run = defaultGhRunner) {
  const pr = parsePrUrl(prUrl);
  if (!pr) return false;
  const comments = listPrComments(pr, run);
  if (comments === null) return false;
  return reserveComment(pr, comments, run);
}
function settleWith(prUrl, body, run) {
  const pr = parsePrUrl(prUrl);
  if (!pr) return false;
  const comments = listPrComments(pr, run);
  if (comments === null) return false;
  if (commentWithStatus(comments, "reported" /* Reported */)) return false;
  if (commentWithStatus(comments, "skipped" /* Skipped */)) return false;
  const reserved = commentWithStatus(comments, "pending" /* Pending */);
  return reserved ? patchPrComment(pr, reserved.id, body, run) : postPrComment(pr, body, run);
}
function settleWalkthroughCommentAsSkipped(prUrl, code, detail, run = defaultGhRunner) {
  return settleWith(prUrl, renderSkippedComment(code, detail), run);
}
function settleWalkthroughCommentForNoAppLogicChange(prUrl, detail, run = defaultGhRunner) {
  const pr = parsePrUrl(prUrl);
  const declared = parseNoAppLogicChangeDetail(detail);
  if (!pr || !declared) return false;
  const comments = listPrComments(pr, run);
  if (comments === null) return false;
  const designated = comments.find(
    (comment) => classifyComment(comment.body) !== "not-designated" /* NotDesignated */
  );
  const lastFullRun = designated ? lastFullRunOf(designated.body) : null;
  const body = renderNoAppLogicChangeComment(declared, readPrHeadSha(pr, run), lastFullRun);
  return designated ? patchPrComment(pr, designated.id, body, run) : postPrComment(pr, body, run);
}
function settleWalkthroughCommentAsUnreasoned(prUrl, run = defaultGhRunner) {
  return settleWith(prUrl, renderUnreasonedSkipComment(), run);
}

// src/e2e-skip/parseSkipDeclaration.ts
var stripQuotes = (text) => text.replace(/["']\s*$/, "").trim();
var asSkipCode = (candidate) => {
  const upper = candidate.toUpperCase();
  return E2E_SKIP_CODES.find((code) => code === upper) ?? null;
};
function judgeSkipDeclaration(cmd) {
  const declared = cmd.match(E2E_SKIP_DECLARATION);
  if (!declared) return null;
  const stated = stripQuotes(declared[1] ?? "");
  if (!stated) return { accepted: false, rejection: "missing-code" /* MissingCode */ };
  const token = stated.match(SKIP_CODE_TOKEN)?.[1];
  if (!token) return { accepted: false, rejection: "missing-code" /* MissingCode */ };
  const code = asSkipCode(token);
  if (!code) return { accepted: false, rejection: "unknown-code" /* UnknownCode */, claimedCode: token };
  const detail = stated.slice(stated.indexOf(token) + token.length).replace(/^[\s:]+/, "").trim();
  return { accepted: true, skip: { code, detail } };
}
var verified = { verified: true };
var refuted = (failure) => ({ verified: false, failure });
var URL_IN_DETAIL = /https?:\/\/[^\s"']+|localhost:\d+/i;
var parseManifest = (manifest) => {
  if (!manifest) return {};
  try {
    return JSON.parse(manifest);
  } catch {
    return {};
  }
};
var verifyNoWebSurface = (context) => {
  if (!context.cwd) return refuted("no working directory was available to inspect");
  const manifest = parseManifest(context.probe.readTextFile(join(context.cwd, "package.json")));
  const serving = Object.entries(manifest.scripts ?? {}).find(
    ([, command]) => WEB_SERVER_COMMAND.test(command)
  );
  if (serving) return refuted(`the "${serving[0]}" script runs a web server (${serving[1]})`);
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const framework = BROWSER_FRAMEWORK_PACKAGES.find((name) => name in dependencies);
  if (framework) return refuted(`${framework} is a declared dependency`);
  const config = WEB_SURFACE_CONFIG_FILES.find(
    (file) => context.probe.readTextFile(join(context.cwd, file)) !== null
  );
  if (config) return refuted(`the repo contains ${config}`);
  return verified;
};
var verifyDevServerUnreachable = (context, detail) => {
  const url = detail.match(URL_IN_DETAIL)?.[0];
  if (!url) return refuted("the detail names no url to probe");
  if (context.probe.isReachable(url)) return refuted(`${url} answered the probe`);
  return verified;
};
var verifyEmptyDiff = (context) => {
  if (!context.cwd) return refuted("no working directory was available to inspect");
  const head = context.probe.runGit(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], context.cwd);
  const base = head?.trim();
  if (!base) return refuted("the repo's base branch could not be resolved");
  const diff = context.probe.runGit(["diff", `${base}...HEAD`, "--stat"], context.cwd);
  if (diff === null) return refuted("the diff against the base branch could not be read");
  if (diff.trim()) return refuted(`the branch carries a diff against ${base}`);
  return verified;
};
var liveSessionExpiry = (session) => {
  if (!session) return null;
  try {
    const expiresAt = JSON.parse(session).expiresAt;
    if (!expiresAt) return null;
    const expiry = Date.parse(expiresAt);
    return !Number.isNaN(expiry) && expiry > Date.now() ? expiresAt : null;
  } catch {
    return null;
  }
};
var verifyMuggleAuthDown = (context) => {
  const muggleHome = join(context.homeDir, MUGGLE_HOME_DIR_NAME);
  const sessionFiles = context.probe.listFiles(muggleHome).filter((name) => OAUTH_SESSION_FILE.test(name));
  for (const name of sessionFiles) {
    const expiresAt = liveSessionExpiry(context.probe.readTextFile(join(muggleHome, name)));
    if (expiresAt) return refuted(`${name} holds a session valid until ${expiresAt}`);
  }
  return verified;
};
var verifyNoPr = (context) => {
  if (context.prsHandled.length === 0) return verified;
  return refuted(`this session handled ${context.prsHandled.join(", ")}`);
};
var verifyUserWaived = (context) => {
  if (!context.transcriptPath) return refuted("no transcript was available to read the waive from");
  const transcript = context.probe.readTextFile(context.transcriptPath);
  if (!transcript) return refuted("the transcript could not be read");
  const tail = transcript.slice(-64e3);
  const waived = tail.split("\n").some((line) => {
    if (!line.includes(USER_WAIVE_PHRASE)) return false;
    try {
      const entry = JSON.parse(line);
      const isUserTurn = entry.type === "user" || entry.message?.role === "user";
      return isUserTurn && JSON.stringify(entry.message?.content ?? "").includes(USER_WAIVE_PHRASE);
    } catch {
      return false;
    }
  });
  if (waived) return verified;
  return refuted(`no user turn in the transcript contains "${USER_WAIVE_PHRASE}"`);
};
var namePaths = (paths) => {
  const named = paths.slice(0, MAX_NAMED_APP_LOGIC_PATHS).join(", ");
  const unnamed = paths.length - MAX_NAMED_APP_LOGIC_PATHS;
  return unnamed > 0 ? `${named} and ${unnamed} more` : named;
};
var verifyNoAppLogicChange = (context, detail) => {
  if (!context.cwd) return refuted("no working directory was available to inspect");
  const declared = parseNoAppLogicChangeDetail(detail);
  if (!declared) {
    return refuted("the detail names no pre-cycle commit \u2014 cite it as NO_APP_LOGIC_CHANGE: <sha> <what changed>");
  }
  const sha = declared.preCycleSha;
  const diff = context.probe.runGit(
    ["diff", "--name-only", "--no-renames", "-z", `${sha}^{commit}`, "HEAD"],
    context.cwd
  );
  if (diff === null) return refuted(`${sha} does not resolve to a commit here, or its diff to HEAD could not be read`);
  const changedPaths = diff.split("\0").filter(Boolean);
  if (changedPaths.length === 0) {
    return refuted(`HEAD carries no change since ${sha} \u2014 declare the skip once the cycle's commits are on HEAD`);
  }
  const appLogicPaths = changedPaths.filter((path) => !isNonAppPath(path));
  if (appLogicPaths.length > 0) return refuted(`app-logic paths changed since ${sha}: ${namePaths(appLogicPaths)}`);
  return verified;
};
var VERIFIERS = {
  ["NO_WEB_SURFACE" /* NoWebSurface */]: verifyNoWebSurface,
  ["DEV_SERVER_UNREACHABLE" /* DevServerUnreachable */]: verifyDevServerUnreachable,
  ["EMPTY_DIFF" /* EmptyDiff */]: verifyEmptyDiff,
  ["MUGGLE_AUTH_DOWN" /* MuggleAuthDown */]: verifyMuggleAuthDown,
  ["NO_PR" /* NoPr */]: verifyNoPr,
  ["USER_WAIVED" /* UserWaived */]: verifyUserWaived,
  ["NO_APP_LOGIC_CHANGE" /* NoAppLogicChange */]: verifyNoAppLogicChange
};
function verifyDeclaredSkip(skip, context) {
  return VERIFIERS[skip.code](context, skip.detail);
}

// src/e2e-skip/resolveSkip.ts
function resolveSkipDeclaration(cmd, context) {
  const judged = judgeSkipDeclaration(cmd);
  if (!judged || !judged.accepted) return judged;
  const checked = verifyDeclaredSkip(judged.skip, context);
  if (checked.verified) return judged;
  return {
    accepted: false,
    rejection: "verification-failed" /* VerificationFailed */,
    claimedCode: judged.skip.code,
    failure: checked.failure
  };
}
var codeMenu = () => E2E_SKIP_CODES.map((code) => `${code} (${E2E_SKIP_CODE_CLAIMS[code]})`).join(", ");
function explainRejection(judged) {
  if (judged.rejection === "missing-code" /* MissingCode */) {
    return `That skip declaration states no code. E2E is skipped only by citing one of: ${codeMenu()}.`;
  }
  if (judged.rejection === "unknown-code" /* UnknownCode */) {
    return `"${judged.claimedCode}" is not a skip code, so E2E is still owed. A skip must name a fact about the environment, not a judgment about the change: ${codeMenu()}. If none of them is true, the run has to happen.`;
  }
  return `The skip cited ${judged.claimedCode}, but that could not be verified: ${judged.failure}. E2E is still owed \u2014 cite a code that holds, or run it.`;
}
var readTextFile = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};
var listFiles = (dir) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};
var runGit = (args, cwd) => {
  const timeoutMs = boundedChildTimeoutMs(GIT_PROBE_TIMEOUT_MS);
  if (timeoutMs === null) return null;
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    });
  } catch {
    return null;
  }
};
var hostAndPort = (url) => {
  const withScheme = /^https?:\/\//i.test(url) ? url : `http://${url}`;
  try {
    const parsed = new URL(withScheme);
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
    return { host: parsed.hostname, port };
  } catch {
    return null;
  }
};
var isReachable = (url) => {
  const target = hostAndPort(url);
  if (!target) return false;
  const spawnTimeoutMs = boundedChildTimeoutMs(DEV_SERVER_PROBE_TIMEOUT_MS * 2);
  if (spawnTimeoutMs === null) return false;
  const socketTimeoutMs = Math.min(DEV_SERVER_PROBE_TIMEOUT_MS, Math.floor(spawnTimeoutMs / 2));
  const script = `const net=require('net');const s=net.connect(${target.port},${JSON.stringify(target.host)});s.setTimeout(${socketTimeoutMs});s.on('connect',()=>{s.destroy();process.exit(0)});s.on('timeout',()=>{s.destroy();process.exit(1)});s.on('error',()=>process.exit(1));`;
  try {
    execFileSync(process.execPath, ["-e", script], {
      timeout: spawnTimeoutMs,
      stdio: "ignore",
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
};
var defaultSkipProbes = {
  readTextFile,
  listFiles,
  runGit,
  isReachable
};

// src/guardrails/skipReason.ts
function judgeE2eSkip(input2, state, probes = defaultSkipProbes) {
  return resolveSkipDeclaration(input2.tool_input?.command ?? "", {
    cwd: input2.cwd,
    prsHandled: state.prsHandled,
    transcriptPath: input2.transcript_path,
    homeDir: homedir(),
    probe: probes
  });
}

// src/guardrails/walkthroughHeadingGate.ts
function evaluateWalkthroughHeadingPost(input2, state, read = defaultFileReader) {
  if (!isShellToolCall(input2)) return { deny: false };
  if (state.e2eRun === true) return { deny: false };
  const cmd = input2.tool_input?.command ?? "";
  if (!isPrReportPostCommand(cmd)) return { deny: false };
  const text = collectPrPostText(cmd, input2.cwd, read);
  const claimsIdentity = text.includes(WALKTHROUGH_COMMENT_HEADING) || text.includes(WALKTHROUGH_SLOT_MARKER);
  if (!claimsIdentity) return { deny: false };
  return {
    deny: true,
    reason: 'Blocked: this comment carries the Muggle walkthrough heading, but no Muggle acceptance run has been recorded this session. That slot is settled by Muggle itself \u2014 either from a real run, or from a verified skip code via `echo "MUGGLE_E2E_SKIP: <CODE>: <detail>"`. If you verified this change some other way, post that as its own comment without the Muggle heading, slot marker, or report sentinel.'
  };
}

// src/guardrails/ledger/constants.ts
var LEDGER_FILE_NAME = "comment-ledger.json";
var LEDGER_VERSION = 1;
var LEDGER_LOCK_WAIT_MS = 3e4;
var LEDGER_COMMIT_ATTEMPTS = 5;
var FOREIGN_CLAIM_EXPIRY_MS = 6 * 60 * 60 * 1e3;

// src/guardrails/ledger/store.ts
var ledgerPath = (slotPath) => join(slotPath, LEDGER_FILE_NAME);
function newThreadEntry(provider) {
  return {
    provider,
    generation: 0,
    humanCommentIds: [],
    coveredCommentIds: [],
    claim: null,
    lastClaimedBySessionId: null,
    lastReplySha: null,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function readLedger(slotPath) {
  const path = ledgerPath(slotPath);
  if (!existsSync(path)) return { version: LEDGER_VERSION, threads: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return { version: parsed.version ?? LEDGER_VERSION, threads: parsed.threads ?? {} };
  } catch {
    return { version: LEDGER_VERSION, threads: {} };
  }
}
function writeLedger(slotPath, ledger) {
  const target = ledgerPath(slotPath);
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, JSON.stringify(ledger, null, 2));
  renameSync(staging, target);
}
function commitThread(slotPath, threadId, mutate) {
  mkdirSync(slotPath, { recursive: true });
  for (let attempt = 0; attempt < LEDGER_COMMIT_ATTEMPTS; attempt += 1) {
    const committed = withFileLock(`${ledgerPath(slotPath)}.lock`, LEDGER_LOCK_WAIT_MS, () => {
      const ledger = readLedger(slotPath);
      const current = ledger.threads[threadId] ?? newThreadEntry("github" /* GitHub */);
      const next = mutate(current);
      ledger.threads[threadId] = {
        ...next,
        generation: current.generation + 1,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      writeLedger(slotPath, ledger);
      return true;
    });
    if (committed === true) return true;
  }
  return false;
}
function isClaimLive(claim, now = Date.now()) {
  if (!claim) return false;
  if (claim.host !== hostname()) {
    return now - Date.parse(claim.claimedAt) < FOREIGN_CLAIM_EXPIRY_MS;
  }
  return isProcessAlive(claim.pid);
}
function uncoveredComments(entry) {
  const covered = new Set(entry.coveredCommentIds);
  return entry.humanCommentIds.filter((commentId) => !covered.has(commentId));
}
function threadState(entry, now = Date.now()) {
  if (uncoveredComments(entry).length === 0) return "processed" /* Processed */;
  if (isClaimLive(entry.claim, now)) return "processing" /* Processing */;
  return "unprocessed" /* Unprocessed */;
}
function claimThread(entry, sessionId2) {
  return {
    ...entry,
    claim: {
      sessionId: sessionId2,
      pid: process.pid,
      host: hostname(),
      claimedAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    lastClaimedBySessionId: sessionId2
  };
}
function coverComments(entry, commentIds, replySha) {
  const covered = [...entry.coveredCommentIds];
  for (const commentId of commentIds) if (!covered.includes(commentId)) covered.push(commentId);
  return { ...entry, coveredCommentIds: covered, lastReplySha: replySha ?? entry.lastReplySha };
}
function refreshHumanComments(entry, humanCommentIds) {
  return { ...entry, humanCommentIds: [...humanCommentIds] };
}

// src/guardrails/commentReply.ts
var REPLY_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_REPLY_SKIP\b/;
var REPLY_SHA_CITATION = /Addressed in ([0-9a-f]{7,40})/;
function parsedResponse(input2) {
  for (const rendered of [input2.tool_response?.stdout, input2.tool_response?.output]) {
    if (!rendered) continue;
    try {
      return JSON.parse(rendered);
    } catch {
      continue;
    }
  }
  return void 0;
}
function collectThreads(value, found) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectThreads(entry, found));
    return;
  }
  if (!value || typeof value !== "object") return;
  const thread = value;
  if (Array.isArray(thread.comments?.nodes) || Array.isArray(thread.notes)) {
    found.push(thread);
    return;
  }
  Object.values(value).forEach((nested) => collectThreads(nested, found));
}
var commentTimestamp = (comment) => comment.createdAt ?? comment.created_at ?? "";
function inChronologicalOrder(comments) {
  if (comments.some((comment) => commentTimestamp(comment) === "")) return comments;
  return [...comments].sort(
    (earlier, later) => commentTimestamp(earlier).localeCompare(commentTimestamp(later))
  );
}
var isLoopAuthored = (comment) => (comment.body ?? "").includes(LOOP_REPLY_MARKER);
function commentsAwaitingReply(comments) {
  const ordered = inChronologicalOrder(comments);
  let lastLoopIndex = -1;
  ordered.forEach((comment, index) => {
    if (isLoopAuthored(comment)) lastLoopIndex = index;
  });
  return ordered.slice(lastLoopIndex + 1).filter((comment) => !isLoopAuthored(comment));
}
function githubThread(thread) {
  if (thread.isResolved === true || !thread.id) return void 0;
  const awaiting = commentsAwaitingReply(thread.comments?.nodes ?? []);
  const humanCommentIds = awaiting.map((comment) => comment.databaseId).filter((databaseId) => databaseId !== void 0).map(String);
  if (humanCommentIds.length === 0) return void 0;
  return {
    threadId: thread.id,
    provider: "github" /* GitHub */,
    humanCommentIds
  };
}
function gitlabThread(thread) {
  const notes = thread.notes ?? [];
  if (!notes.some((note) => note.resolved === false) || !thread.id) return void 0;
  const humanCommentIds = commentsAwaitingReply(notes).map((note) => note.id).filter((noteId) => noteId !== void 0).map(String);
  if (humanCommentIds.length === 0) return void 0;
  return {
    threadId: thread.id,
    provider: "gitlab" /* GitLab */,
    humanCommentIds
  };
}
function detectUnansweredThreads(input2) {
  if (!isShellToolCall(input2)) return [];
  if (!REVIEW_THREAD_FETCH_COMMAND.test(input2.tool_input?.command ?? "")) return [];
  const threads = [];
  collectThreads(parsedResponse(input2), threads);
  return threads.map((thread) => Array.isArray(thread.notes) ? gitlabThread(thread) : githubThread(thread)).filter((thread) => thread !== void 0);
}
function detectConfirmedReplies(input2) {
  if (!isShellToolCall(input2)) return [];
  const command = input2.tool_input?.command ?? "";
  const targets = [...command.matchAll(THREADED_REPLY_TARGET)].map(
    ([, githubCommentId, gitlabDiscussionId]) => githubCommentId ?? gitlabDiscussionId
  );
  if (targets.length === 0) return [];
  const created = parsedResponse(input2);
  if (created?.id === void 0) return [];
  const replySha = REPLY_SHA_CITATION.exec(created.body ?? "")?.[1] ?? null;
  return targets.map((targetId) => ({ targetId, replySha }));
}
function isReplySkipMarker(command) {
  return REPLY_SKIP_MARKER.test(command);
}
function threadForReplyTarget(ledger, targetId) {
  if (ledger.threads[targetId]) return targetId;
  for (const [threadId, entry] of Object.entries(ledger.threads)) {
    if (entry.humanCommentIds.includes(targetId)) return threadId;
  }
  return void 0;
}
function resolveSlotForPr(prUrl, sessionsDirOverride) {
  const sessionsDir = join(homedir(), ".muggle-ai", "muggle-do", "sessions");
  if (!existsSync(sessionsDir)) return void 0;
  for (const slug of readdirSync(sessionsDir)) {
    const slotPath = join(sessionsDir, slug);
    try {
      const parsed = JSON.parse(readFileSync(join(slotPath, "prs.json"), "utf-8"));
      const slotPr = Array.isArray(parsed) ? parsed[0] : parsed;
      if (slotPr?.url === prUrl) return slotPath;
    } catch {
      continue;
    }
  }
  return void 0;
}
function overdueThreads(slotPath, sessionId2) {
  const overdue = [];
  for (const [threadId, entry] of Object.entries(readLedger(slotPath).threads)) {
    if (entry.lastClaimedBySessionId !== sessionId2) continue;
    if (threadState(entry) === "processed" /* Processed */) continue;
    overdue.push({ threadId, uncovered: uncoveredComments(entry) });
  }
  return overdue;
}
function commentReplyGateDecision(state, overdue, maxBlocks = MAX_REPLY_BLOCKS) {
  const blockCount = state.commentReplyBlockCount ?? 0;
  const unanswered = overdue.flatMap((thread) => thread.uncovered);
  if (state.commentReplySkipped === true || unanswered.length === 0) {
    return { action: "none" /* None */, blockCount, unanswered };
  }
  if (blockCount >= maxBlocks) {
    return {
      action: "release" /* Release */,
      blockCount,
      unanswered
    };
  }
  return {
    action: "block" /* Block */,
    blockCount: blockCount + 1,
    unanswered
  };
}
function deferredCommentIds(ledger, command) {
  const deferred = [];
  for (const [threadId, entry] of Object.entries(ledger.threads)) {
    const named = uncoveredComments(entry).filter((commentId) => command.includes(commentId));
    if (named.length > 0) deferred.push({ threadId, commentIds: named });
  }
  return deferred;
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
  if (!isShellToolCall(input2)) return { deny: false };
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
  if (!isShellToolCall(input2)) return { deny: false };
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
function mergeHookOutputs(gateOutputs, host2) {
  const parsedOutputs = gateOutputs.flatMap((gateOutput) => {
    try {
      return [JSON.parse(gateOutput)];
    } catch {
      return [];
    }
  });
  const denyReasons = parsedOutputs.filter((parsed) => parsed.hookSpecificOutput?.permissionDecision === "deny").map((parsed) => parsed.hookSpecificOutput?.permissionDecisionReason ?? "").filter(Boolean);
  if (denyReasons.length > 0) return denyTool(denyReasons.join(MERGED_GATE_OUTPUT_SEPARATOR), host2);
  const blockReasons = parsedOutputs.filter((parsed) => parsed.decision === "block").map((parsed) => parsed.reason ?? "").filter(Boolean);
  if (blockReasons.length > 0) return blockStop(blockReasons.join(MERGED_GATE_OUTPUT_SEPARATOR), host2);
  const contexts = parsedOutputs.map((parsed) => parsed.hookSpecificOutput?.additionalContext ?? parsed.additional_context ?? "").filter(Boolean);
  if (contexts.length === 0) return "{}";
  const hookEventName = parsedOutputs.find((parsed) => parsed.hookSpecificOutput?.hookEventName)?.hookSpecificOutput?.hookEventName;
  return envelope(hookEventName ?? "", contexts.join(MERGED_GATE_OUTPUT_SEPARATOR), host2);
}

// src/guardrails/hookInput.ts
function normalizeHookInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const payload = raw;
  if (typeof payload.tool_response === "string") {
    return { ...payload, tool_response: { output: payload.tool_response } };
  }
  return payload;
}

// src/guardrails/hookHost.ts
function resolveHookHost(env = process.env) {
  if (env[HOOK_HOST_ENV_VAR] === "codex") return "codex";
  if (env.CURSOR_PLUGIN_ROOT) return "cursor";
  return "claude";
}
function skillInvocation(slashCommand, host2) {
  if (host2 !== "codex") return slashCommand;
  return `$muggle:${slashCommand.replace(/^\/(?:muggle:)?/, "")}`;
}

// src/guardrails/cli.ts
function readStdin() {
  try {
    return normalizeHookInput(JSON.parse(readFileSync(0, "utf-8")));
  } catch {
    return {};
  }
}
var host = resolveHookHost();
var sub = process.argv[2];
if (!isBackgroundJob(sub)) enforceHookChildProcessDeadline();
var input = readStdin();
var sessionId = input.session_id ?? "unknown";
function releaseGate(field) {
  updateState(
    sessionId,
    (current) => current[field] === true ? current : { ...current, [field]: true }
  );
  return "{}";
}
function muggleSkill(slashCommand) {
  return skillInvocation(slashCommand, host);
}
function nextOptionsOfferMethod() {
  return host === "codex" ? "by asking them in your closing message (request_user_input where it is available)" : "via AskUserQuestion";
}
function prOpened() {
  const url = detectPrOpened(input);
  if (!url) return "{}";
  if (readState(sessionId).prsHandled.includes(url)) return "{}";
  markPrHandled(sessionId, url);
  updateState(sessionId, applyPrOpenedToWalkthroughs);
  startBackgroundJob("reserve-walkthrough-comment" /* ReserveWalkthroughComment */, [url]);
  if (isWalkthroughGateArmed(readState(sessionId))) {
    startBackgroundJob("scan-walkthroughs" /* ScanWalkthroughs */, [sessionId], input.cwd);
  }
  const ctx = `A pull request was just opened: ${url}
Its Muggle AI visual-walkthrough comment is reserved and empty \u2014 settle it with the E2E run of this PR's own change (a wave's PRs share one run; any other PR gets its own), or by recording why E2E does not apply.
Per the autoWatchPR preference, a muggle-pr-followup watcher should handle its incoming reviews. If autoWatchPR=always, start it now by invoking ${muggleSkill("/muggle:muggle-pr-followup")} with the PR URL; if =ask, offer it to the user; if =never, do nothing.`;
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
  const ctx = `PR #${terminalEvent.prNumber} went terminal (${terminalEvent.verdict}). Run the post-merge handoff now: finalize the watcher slot, tear down per autoCleanup, then OFFER NEXT OPTIONS to the user ${nextOptionsOfferMethod()} \u2014 release, queued work, deferred items. The stop gate holds until the offer runs.`;
  return envelope("PostToolUse", ctx, host);
}
function offerRan() {
  if (!NEXT_OPTIONS_OFFER_TOOL_NAMES.includes(input.tool_name ?? "")) return "{}";
  const state = readState(sessionId);
  const next = applyNextOptionsOffered(state);
  if (next !== state) writeState(next);
  return "{}";
}
function terminalGate() {
  const pendingState = readState(sessionId);
  const state = host === "codex" && closingMessageAsksUser(input.last_assistant_message) ? applyNextOptionsOffered(pendingState) : pendingState;
  if (state !== pendingState) writeState(state);
  const decision = prTerminalGateDecision(state);
  if (decision.action === "release" /* Release */) return releaseGate("terminalReleased");
  if (decision.action !== "block" /* Block */) return "{}";
  state.terminalBlockCount = decision.blockCount;
  writeState(state);
  const pendingPrList = (state.terminalPending ?? []).map((prNumber) => `#${prNumber}`).join(", ");
  const reason = decision.blockCount === 1 ? `Do not end the turn yet. PR ${pendingPrList} went terminal (merged/closed) but the post-merge handoff has not run. Finalize the watcher slot, tear down per autoCleanup, then offer next options to the user ${nextOptionsOfferMethod()} \u2014 release, queued work, deferred items. Only that offer clears this gate.` : `Post-merge handoff still owed for PR ${pendingPrList} (reminder ${decision.blockCount}/${MAX_PR_TERMINAL_BLOCKS}): finalize + tear down, then offer the next options ${nextOptionsOfferMethod()}.`;
  return blockStop(reason, host);
}
function recordTests() {
  const cmd = input.tool_input?.command ?? "";
  const stateBefore = readState(sessionId);
  const judgedSkip = judgeE2eSkip(input, stateBefore);
  const acceptedSkip = judgedSkip?.accepted ? judgedSkip.skip : null;
  const run = {
    unitTestPassed: isTestCommand(cmd) && testsPassed(input),
    e2eRan: isE2ERun(input),
    e2eSkipped: acceptedSkip !== null,
    e2eSkipCycleScoped: acceptedSkip !== null && CYCLE_SCOPED_SKIP_CODES.includes(acceptedSkip.code)
  };
  const walkthroughPosted = detectWalkthroughPost(input);
  const failedRunId = detectFailedRunId(input);
  const record = (state) => {
    const recorded = applyRecordedRun(state, run);
    const withWatchSkip = applyWatchSkip(recorded, isWatchSkipMarker(cmd));
    const withBuildSkip = applyBuildSkip(withWatchSkip, isBuildSkipMarker(cmd));
    const withWalkthroughPost = applyWalkthroughPosted(withBuildSkip, walkthroughPosted, Date.now());
    const withWalkthroughSkip = applyWalkthroughSkip(withWalkthroughPost, isWalkthroughSkipMarker(cmd));
    return failedRunId ? applyFailedRun(withWalkthroughSkip, failedRunId) : withWalkthroughSkip;
  };
  const next = commitState(sessionId, record) ?? record(readState(sessionId));
  if (isWalkthroughGateArmed(next) && (walkthroughPosted || !isWalkthroughGateArmed(stateBefore))) {
    startBackgroundJob("scan-walkthroughs" /* ScanWalkthroughs */, [sessionId], input.cwd);
  }
  if (acceptedSkip) recordSkipReasonOnBranchPr(acceptedSkip);
  if (judgedSkip && !judgedSkip.accepted) {
    return envelope("PostToolUse", explainRejection(judgedSkip), host);
  }
  return "{}";
}
function recordSkipReasonOnBranchPr(skip) {
  if (skip.code === "NO_APP_LOGIC_CHANGE" /* NoAppLogicChange */) {
    startBackgroundJob("settle-walkthrough-no-app-logic-change" /* SettleWalkthroughNoAppLogicChange */, [skip.detail], input.cwd);
    return;
  }
  startBackgroundJob("settle-walkthrough-skipped" /* SettleWalkthroughSkipped */, [skip.code, skip.detail], input.cwd);
}
function recordDelegation() {
  const prUrls = detectBackgroundAcceptanceDispatch(input);
  if (prUrls === null) return "{}";
  const delegate = (state) => applyE2eDelegation(state, { dispatchedAt: Date.now(), prUrls });
  updateState(sessionId, delegate);
  return "{}";
}
function skillStages() {
  const skillName = resolveSkillNameFromToolInput(input.tool_input);
  if (!skillName) return "{}";
  const stagePaths = resolveSkillStagePaths(skillName, resolvePluginSkillsRoot());
  const invoke = (state) => applySkillInvocation(state, skillName, stagePaths);
  const next = commitState(sessionId, invoke) ?? invoke(readState(sessionId));
  const unread = unreadMandatoryStages(next);
  if (unread.length === 0) return "{}";
  const ctx = `The ${skillName} skill declares required reading: ${unread.map(stageLabel).join(", ")}. Read those files now, before working through the skill's steps \u2014 they carry mandatory steps SKILL.md only links to, and treating them as optional elaboration is how those steps get silently dropped. A Stop gate holds the turn open until they are opened.`;
  return envelope("PostToolUse", ctx, host);
}
function recordStageRead() {
  const filePath = input.tool_input?.file_path;
  const readPaths = filePath ? [filePath].filter(isSkillTreeMarkdown) : isShellToolCall(input) ? detectShellStageReads(input.tool_input?.command ?? "", input.cwd) : [];
  if (readPaths.length === 0) return "{}";
  if (callFailed(input)) return "{}";
  const state = readState(sessionId);
  const next = readPaths.reduce(applyStageRead, state);
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
  if (decision.action === "release" /* Release */) return releaseGate("stageReleased");
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
  if (decision.action === "release" /* Release */) return releaseGate("debugReleased");
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
  if (decision.action === "release" /* Release */) {
    for (const prUrl of state.prsHandled) {
      startBackgroundJob("settle-walkthrough-unreasoned" /* SettleWalkthroughUnreasoned */, [prUrl]);
    }
    return releaseGate("e2eReleased");
  }
  if (decision.action === "none" /* None */) return "{}";
  state.e2eBlockCount = decision.blockCount;
  writeState(state);
  const reason = decision.blockCount === 1 ? `Do not end the turn yet. This session went unit-green or opened a PR, but no E2E acceptance run has happened. Per the autoE2ETest preference (default: always), run change-driven E2E now via ${muggleSkill("/muggle:muggle-test")}, then finish. A skip states a fact about the environment, never a judgment about the change: run \`echo "MUGGLE_E2E_SKIP: <CODE>: <detail>"\` citing one of ${E2E_SKIP_CODES.join(", ")}. Muggle verifies the code itself, so one that does not hold leaves this gate blocked.` : `E2E acceptance run still owed (reminder ${decision.blockCount}/${MAX_E2E_BLOCKS}): run ${muggleSkill("/muggle:muggle-test")}, or cite a verifiable code via \`echo "MUGGLE_E2E_SKIP: <CODE>: <detail>"\`.`;
  return blockStop(reason, host);
}
function watchGate() {
  const state = readState(sessionId);
  const unwatchedPrUrls = findUnwatchedHandledPrs(state.prsHandled);
  const prStateScan = readPrStateScan(sessionId);
  if (state.watchSkipped !== true && prsAwaitingStateScan(unwatchedPrUrls, state, prStateScan).length > 0) {
    startBackgroundJob("scan-watch-pr-states" /* ScanWatchPrStates */, [sessionId]);
  }
  const decision = watchGateDecision(state, resolveOwedWatchPrs(unwatchedPrUrls, state, prStateScan));
  if (decision.action === "release" /* Release */) return releaseGate("watchReleased");
  if (decision.action === "none" /* None */) return "{}";
  state.watchBlockCount = decision.blockCount;
  writeState(state);
  const prList = decision.unwatched.join(", ");
  const staleMinutes = WATCH_HEARTBEAT_STALE_MS / 6e4;
  const armCommand = `${muggleSkill("/muggle:muggle-pr-followup")} ${decision.unwatched[0]}`;
  const reason = decision.blockCount === 1 ? `Do not end the turn yet. A PR opened this session is open with no live muggle-pr-followup watch: ${prList}. Arm its watch per the muggle-pr-followup arming procedure (arm-watcher.md) \u2014 invoking ${armCommand} bootstraps it and arms it that way (add --resume when its slot already exists). A seeded slot does not count: only a running watch loop does, shown by a watch-heartbeat it touches every poll and that goes stale after ${staleMinutes} minutes (a watch armed moments ago writes it on its first poll). If the PR already merged or closed, end the turn again \u2014 a provider check started now clears it. If it genuinely should not be watched (autoWatchPR=never, handed off elsewhere), tell the user why and run \`echo "MUGGLE_WATCH_SKIP: <reason>"\` \u2014 that records the skip and keeps this gate quiet for the rest of the session.` : `PR watch still owed for ${prList} (reminder ${decision.blockCount}/${MAX_WATCH_BLOCKS}): arm it per arm-watcher.md via ${armCommand} (--resume when its slot exists), or record a legitimate skip via \`echo "MUGGLE_WATCH_SKIP: <reason>"\`.`;
  return blockStop(reason, host);
}
function buildFollowthroughGate() {
  const state = readState(sessionId);
  const decision = buildFollowthroughDecision(state);
  if (decision.action === "release" /* Release */) return releaseGate("buildSkipped");
  if (decision.action === "none" /* None */) return "{}";
  state.buildBlockCount = decision.blockCount;
  writeState(state);
  const reason = decision.blockCount === 1 ? `Do not end the turn yet. This session took a build/implement/fix request but no PR was opened. A root cause written into the transcript ships nothing \u2014 once the session ends it is gone, and the watcher gate never fires because it only looks at PRs that exist. Carry the work to a PR via ${muggleSkill("/muggle-do")}, which runs requirements \u2192 build \u2192 impact \u2192 unit tests \u2192 E2E \u2192 PR \u2192 watcher. If no PR is owed here (the user changed their mind, the fix landed in another repo, the answer was advice rather than a change), tell the user why and run \`echo "MUGGLE_BUILD_SKIP: <reason>"\` \u2014 that records the skip and keeps this gate quiet for the rest of the session.` : `Build request still unanswered \u2014 no PR opened (reminder ${decision.blockCount}/${MAX_BUILD_BLOCKS}): carry it to a PR via ${muggleSkill("/muggle-do")}, or record a legitimate skip via \`echo "MUGGLE_BUILD_SKIP: <reason>"\`.`;
  return blockStop(reason, host);
}
function walkthroughGate() {
  const state = readState(sessionId);
  if (!isWalkthroughGateArmed(state)) return "{}";
  const scan = readWalkthroughScan(sessionId);
  startBackgroundJob("scan-walkthroughs" /* ScanWalkthroughs */, [sessionId], input.cwd);
  if (!scan || !isWalkthroughScanCurrent(scan, state)) return "{}";
  if (scan.owed.length === 0) {
    if (scan.verified.length > 0) writeState({ ...state, walkthroughsVerified: true });
    return "{}";
  }
  const decision = walkthroughGateDecision(state, withoutDelegatedPrs(scan.owed, state, Date.now()));
  if (decision.action === "release" /* Release */) return releaseGate("walkthroughReleased");
  if (decision.action !== "block" /* Block */) return "{}";
  state.walkthroughBlockCount = decision.blockCount;
  writeState(state);
  const prList = decision.owed.join(", ");
  const reason = decision.blockCount === 1 ? `Do not end the turn yet. An E2E acceptance run happened this session but no visual walkthrough has reached ${prList}. Each PR carries the run of its own change \u2014 a wave's PRs share one run, every other PR gets its own \u2014 so never post one change's run to another change's PR. If this PR's change was tested, post that run now per the postPRVisualWalkthrough preference (default: always) via ${muggleSkill("/muggle:muggle-pr-visual-walkthrough")} \u2014 include the failed runs, which are the ones reviewers most need to see. If it was not, run E2E for it first: inline via ${muggleSkill("/muggle:muggle-test")}, or in a background muggle:acceptance-tester per do/background-e2e.md while other work continues. If this result genuinely should not be posted (postPRVisualWalkthrough=never, someone else's PR, nothing renderable), tell the user why and run \`echo "MUGGLE_WALKTHROUGH_SKIP: <reason>"\` \u2014 that records the skip and keeps this gate quiet for the rest of the session.` : `Walkthrough still owed for ${prList} (reminder ${decision.blockCount}/${MAX_WALKTHROUGH_BLOCKS}): post that PR's own run via ${muggleSkill("/muggle:muggle-pr-visual-walkthrough")}, run E2E for it first if its change was never tested, or record a legitimate skip via \`echo "MUGGLE_WALKTHROUGH_SKIP: <reason>"\`.`;
  return blockStop(reason, host);
}
function slotForSession(state) {
  for (const prUrl of state.prsHandled) {
    const slotPath = resolveSlotForPr(prUrl);
    if (slotPath) return slotPath;
  }
  return void 0;
}
function recordCommentReplies() {
  const cmd = input.tool_input?.command ?? "";
  const state = readState(sessionId);
  const slotPath = slotForSession(state);
  if (!slotPath) return "{}";
  if (isReplySkipMarker(cmd)) {
    const deferred = deferredCommentIds(readLedger(slotPath), cmd);
    if (deferred.length === 0) {
      updateState(sessionId, (current) => ({ ...current, commentReplySkipped: true }));
      return "{}";
    }
    for (const { threadId, commentIds } of deferred) {
      commitThread(slotPath, threadId, (entry) => coverComments(entry, commentIds, null));
    }
    return "{}";
  }
  for (const thread of detectUnansweredThreads(input)) {
    commitThread(
      slotPath,
      thread.threadId,
      (entry) => claimThread(
        refreshHumanComments({ ...entry, provider: thread.provider }, thread.humanCommentIds),
        sessionId
      )
    );
  }
  const confirmed = detectConfirmedReplies(input);
  if (confirmed.length > 0) {
    const ledger = readLedger(slotPath);
    for (const reply of confirmed) {
      const threadId = threadForReplyTarget(ledger, reply.targetId);
      if (!threadId) continue;
      const covered = threadId === reply.targetId ? uncoveredComments(ledger.threads[threadId]) : [reply.targetId];
      commitThread(slotPath, threadId, (entry) => coverComments(entry, covered, reply.replySha));
    }
  }
  return "{}";
}
function commentReplyGate() {
  const state = readState(sessionId);
  const slotPath = slotForSession(state);
  if (!slotPath) return "{}";
  const decision = commentReplyGateDecision(state, overdueThreads(slotPath, sessionId));
  if (decision.action === "release" /* Release */) return releaseGate("commentReplyReleased");
  if (decision.action !== "block" /* Block */) return "{}";
  updateState(sessionId, (current) => ({ ...current, commentReplyBlockCount: decision.blockCount }));
  const commentList = decision.unanswered.join(", ");
  const reason = decision.blockCount === 1 ? `Do not end the turn yet. This session took these review comments as work and never answered them: ${commentList}. Post one reply per comment in its own thread per muggle-do do/per-comment-replies.md \u2014 "Addressed in <short-sha>: <what changed for THIS comment>", signed via sign-body.sh --mode loop. A silent round leaves the reviewer with no answer in the thread, and the loop marker that reply carries is the only thing that stops the watcher re-dispatching the same thread next tick. If a comment was escalated to the user instead of answered, record it as deferred rather than replying.` : `Review comments still owe a threaded reply (reminder ${decision.blockCount}/${MAX_REPLY_BLOCKS}): ${commentList}. Reply per do/per-comment-replies.md, or record the deferral.`;
  return blockStop(reason, host);
}
function reportGate() {
  const reportPostVerdict = evaluateReportPost(input);
  if (!reportPostVerdict.deny || !reportPostVerdict.reason) return "{}";
  return denyTool(reportPostVerdict.reason, host);
}
function walkthroughHeadingGate() {
  const headingVerdict = evaluateWalkthroughHeadingPost(input, readState(sessionId));
  if (!headingVerdict.deny || !headingVerdict.reason) return "{}";
  return denyTool(headingVerdict.reason, host);
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
  const ctx = `This looks like a build/implement/fix request. Per the autoRouteBuildToMuggleDo preference, route it through ${muggleSkill("/muggle-do")} \u2014 which runs requirements \u2192 build (delegated to superpowers' design\u2192plan\u2192review) \u2192 impact \u2192 unit tests \u2192 E2E \u2192 PR \u2192 watcher. If autoRouteBuildToMuggleDo=always, enter that flow; if =ask, offer it; if =never, proceed normally.`;
  return envelope("UserPromptSubmit", ctx, host);
}
function closingAssistantText() {
  if (typeof input.last_assistant_message === "string") return input.last_assistant_message;
  const transcriptPath = input.transcript_path;
  if (!transcriptPath) return "";
  try {
    return lastAssistantText(
      readFileSync(transcriptPath, "utf-8").slice(-CAPABILITY_CLAIM_TRANSCRIPT_TAIL_BYTES)
    );
  } catch {
    return "";
  }
}
function capabilityClaimGate() {
  const state = readState(sessionId);
  if (state.capabilityClaimNudged) return "{}";
  if (!detectFalseCapabilityClaim(closingAssistantText())) return "{}";
  state.capabilityClaimNudged = true;
  writeState(state);
  const reason = `Do not end the turn yet. This turn tells the user that a login- or code-gated flow cannot be tested, reached, or verified \u2014 the one class of blocker Muggle clears. Every managed login profile owns a live inbox, so magic-link and sign-in-link logins, emailed OTPs, email-based 2FA, verification mail, and password resets run end to end with no mail stub and no test-only backdoor. An SMS code is read from the profile's provisioned number, an authenticator code is derived offline from its stored TOTP secret, and stored credentials and CAPTCHA solving are covered too. Re-read plugin/skills/_shared/identity-and-inbox.md, then correct the claim or run the flow. Genuine limits stay sayable: a voice call, an OAuth-only provider, or an account with no phone number provisioned (the runner cannot mint one) \u2014 name the one that applies and move on.`;
  return blockStop(reason, host);
}
function runFiringGates() {
  const gateOutputs = process.argv.slice(3).map((firingSubcommand) => {
    try {
      return (handlers[firingSubcommand] ?? (() => "{}"))();
    } catch {
      return "{}";
    }
  });
  return mergeHookOutputs(gateOutputs, host);
}
var handlers = {
  run: runFiringGates,
  "pr-opened": prOpened,
  "capability-claim-gate": capabilityClaimGate,
  "pr-terminal": prTerminal,
  "offer-ran": offerRan,
  "record-tests": recordTests,
  "record-delegation": recordDelegation,
  "e2e-gate": e2eGate,
  "terminal-gate": terminalGate,
  "watch-gate": watchGate,
  "build-followthrough-gate": buildFollowthroughGate,
  "walkthrough-gate": walkthroughGate,
  "record-comment-replies": recordCommentReplies,
  "comment-reply-gate": commentReplyGate,
  "report-gate": reportGate,
  "walkthrough-heading-gate": walkthroughHeadingGate,
  "resolve-gate": resolveGate,
  "build-router": buildRouter,
  "skill-stages": skillStages,
  "record-stage-read": recordStageRead,
  "record-stage-signals": recordStageSignals,
  "classify-gate": classifyGate,
  "stage-gate": stageGate,
  "debug-path-gate": debugPathGate
};
var jobArgs = process.argv.slice(3);
function scanWalkthroughsJob() {
  const scannedSessionId = jobArgs[0] ?? "unknown";
  const startedAt = Date.now();
  const state = readState(scannedSessionId);
  const scan = scanForOwedWalkthroughs(state);
  writeWalkthroughScan(scannedSessionId, {
    prsHandled: state.prsHandled,
    owed: scan.owed,
    verified: scan.verified,
    startedAt
  });
  return "{}";
}
function reserveWalkthroughCommentJob() {
  const [prUrl] = jobArgs;
  if (prUrl) reserveWalkthroughComment(prUrl);
  return "{}";
}
function settleWalkthroughSkippedJob() {
  const [codeArg, detail] = jobArgs;
  const code = E2E_SKIP_CODES.find((skipCode) => skipCode === codeArg);
  if (!code) return "{}";
  const prUrl = defaultPrWalkthroughLookup.branchPrUrl();
  if (prUrl) settleWalkthroughCommentAsSkipped(prUrl, code, detail ?? "");
  return "{}";
}
function settleWalkthroughUnreasonedJob() {
  const [prUrl] = jobArgs;
  if (prUrl) settleWalkthroughCommentAsUnreasoned(prUrl);
  return "{}";
}
function settleWalkthroughNoAppLogicChangeJob() {
  const [detail] = jobArgs;
  const prUrl = defaultPrWalkthroughLookup.branchPrUrl();
  if (prUrl && detail) settleWalkthroughCommentForNoAppLogicChange(prUrl, detail);
  return "{}";
}
function scanWatchPrStatesJob() {
  const scannedSessionId = jobArgs[0] ?? "unknown";
  const state = readState(scannedSessionId);
  const previousScan = readPrStateScan(scannedSessionId);
  const awaitingPrUrls = prsAwaitingStateScan(findUnwatchedHandledPrs(state.prsHandled), state, previousScan);
  if (awaitingPrUrls.length === 0) return "{}";
  const freshScan = scanProviderPrStates(awaitingPrUrls);
  writePrStateScan(scannedSessionId, { states: { ...previousScan?.states, ...freshScan.states } });
  return "{}";
}
var backgroundJobs = {
  ["scan-walkthroughs" /* ScanWalkthroughs */]: scanWalkthroughsJob,
  ["reserve-walkthrough-comment" /* ReserveWalkthroughComment */]: reserveWalkthroughCommentJob,
  ["settle-walkthrough-skipped" /* SettleWalkthroughSkipped */]: settleWalkthroughSkippedJob,
  ["settle-walkthrough-unreasoned" /* SettleWalkthroughUnreasoned */]: settleWalkthroughUnreasonedJob,
  ["settle-walkthrough-no-app-logic-change" /* SettleWalkthroughNoAppLogicChange */]: settleWalkthroughNoAppLogicChangeJob,
  ["scan-watch-pr-states" /* ScanWatchPrStates */]: scanWatchPrStatesJob
};
var runSubcommand = isBackgroundJob(sub) ? backgroundJobs[sub] : handlers[sub] ?? (() => "{}");
process.stdout.write(runSubcommand());
