import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { HOOK_HOST_ENV_VAR } from "../../../guardrails/constants.js";
import { normalizeStagePath, resolveSkillStagePaths } from "../../../guardrails/mandatoryStages.js";
import { PLUGIN_ROOT } from "../footprint/constants.js";
import { HookEvent, type HookSlot } from "../footprint/types.js";
import {
  createHookHome,
  createWalkthroughProbeGhStub,
  guardrailSubcommandsForSlot,
  providerFreeEnvironment,
  runGuardrailCli,
  sessionSlotDirectory,
  walkthroughProbeAnswerEnvironment,
  writeSessionSlotFiles,
} from "../hook-harness/hookHarness.js";
import type { GuardrailCliRun } from "../hook-harness/types.js";
import {
  E2E_LOCAL_URL,
  E2E_RUN_RESULT,
  E2E_TEST_SCRIPT_ID,
  FORWARD_STAGE_FILES,
  HANDOFF_BASE_BRANCH,
  HANDOFF_BUILD_PROMPT,
  HANDOFF_BUILD_REQUEST,
  HANDOFF_CLOSING_MESSAGE,
  HANDOFF_HEAD_SHA,
  HANDOFF_PR_NUMBER,
  HANDOFF_PR_TITLE,
  HANDOFF_PR_URL,
  HANDOFF_REPO_SLUG,
  HANDOFF_SESSION_ID,
  HANDOFF_SLOT_SLUG,
  MUGGLE_DO_SKILL_NAME,
  MUGGLE_EXECUTE_REPLAY_TOOL,
  MUGGLE_TELEMETRY_SKILL_EMIT_TOOL,
  NO_WEB_SURFACE_MANIFEST,
  NO_WEB_SURFACE_SKIP_DECLARATION,
  PLUGIN_SKILLS_ROOT,
  PR_CONTENT_WITHOUT_WALKTHROUGH,
  PR_CREATE_COMMAND,
  PR_WATCH_ARM_SCRIPT,
  TELEMETRY_EMIT_RESULT,
  UNIT_TEST_COMMAND,
  UNIT_TEST_OUTPUT,
  WALKTHROUGH_BODY,
  WALKTHROUGH_BODY_FILE,
  WALKTHROUGH_COMMENT_URL,
  WALKTHROUGH_POST_COMMAND,
  WATCH_ARM_OUTPUT,
  WATCH_HEARTBEAT_FILE,
  WATCH_LOOP_PID,
  WATCH_MONITOR_TIMEOUT_MS,
  WATCH_WATERMARK,
} from "./constants.js";
import {
  HandoffStep,
  ReplayedInteractionKind,
  type HandoffSession,
  type ReplayedHookAnswer,
  type ReplayedInteraction,
  type ReplayedToolCall,
} from "./types.js";

function toolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse: unknown,
  applySideEffect?: () => void,
): ReplayedToolCall {
  return {
    kind: ReplayedInteractionKind.ToolCall,
    toolName: toolName,
    toolInput: toolInput,
    toolResponse: toolResponse,
    applySideEffect: applySideEffect,
  };
}

function shellCall(command: string, stdout: string): ReplayedToolCall {
  return toolCall("Bash", { command: command }, { stdout: stdout, stderr: "", interrupted: false, isImage: false });
}

// An MCP tool answers with typed content parts rather than a stream.
function mcpTextResult(text: string): unknown {
  return [{ type: "text", text: text }];
}

// The forward run's stage files plus anything muggle-do declares as mandatory, so a declaration added later is
// read the way the skill would have it read.
function stageFilesToRead(): string[] {
  const forwardStagePaths = FORWARD_STAGE_FILES.map((relativePath) => join(PLUGIN_SKILLS_ROOT, relativePath));
  const forwardStageKeys = new Set(forwardStagePaths.map(normalizeStagePath));
  const declaredStagePaths = resolveSkillStagePaths(MUGGLE_DO_SKILL_NAME, PLUGIN_SKILLS_ROOT).filter(
    (declaredPath) => !forwardStageKeys.has(declaredPath),
  );
  return [...forwardStagePaths, ...declaredStagePaths];
}

function watcherHandoffInteractions(session: HandoffSession): ReplayedInteraction[] {
  const slotDirectory = sessionSlotDirectory(session.home, HANDOFF_SLOT_SLUG);
  const prsJsonPath = join(slotDirectory, "prs.json");
  const prsJson = JSON.stringify(
    [
      {
        repo: HANDOFF_REPO_SLUG,
        provider: "github",
        number: HANDOFF_PR_NUMBER,
        url: HANDOFF_PR_URL,
        head_sha: HANDOFF_HEAD_SHA,
        state: "open",
      },
    ],
    null,
    2,
  );
  const armCommand =
    `bash "${PR_WATCH_ARM_SCRIPT}" --slot "${slotDirectory}" --repo ${HANDOFF_REPO_SLUG} ` +
    `--pr ${HANDOFF_PR_NUMBER} --base ${HANDOFF_BASE_BRANCH}`;
  return [
    toolCall(
      "Write",
      { file_path: prsJsonPath, content: prsJson },
      { type: "create", filePath: prsJsonPath },
      () => writeSessionSlotFiles(session.home, HANDOFF_SLOT_SLUG, { "prs.json": prsJson }),
    ),
    // The arm seeds the watermark and execs the loop, whose first poll claims the PID lease and touches the
    // heartbeat — so the slot is left with a fresh heartbeat, as a live watch's would be.
    toolCall(
      "Monitor",
      {
        command: armCommand,
        description: `PR #${HANDOFF_PR_NUMBER} — ${HANDOFF_PR_TITLE}`,
        timeout_ms: WATCH_MONITOR_TIMEOUT_MS,
        persistent: true,
      },
      { stdout: WATCH_ARM_OUTPUT },
      () =>
        writeSessionSlotFiles(session.home, HANDOFF_SLOT_SLUG, {
          "watch-watermark.env": WATCH_WATERMARK,
          "watch.pid": WATCH_LOOP_PID,
          [WATCH_HEARTBEAT_FILE]: "",
        }),
    ),
  ];
}

const HANDOFF_STEP_INTERACTIONS: Record<HandoffStep, (session: HandoffSession) => ReplayedInteraction[]> = {
  [HandoffStep.BuildRequest]: () => [{ kind: ReplayedInteractionKind.Prompt, prompt: HANDOFF_BUILD_PROMPT }],
  [HandoffStep.SkillInvocation]: () => [
    toolCall(
      "Skill",
      { skill: `muggle:${MUGGLE_DO_SKILL_NAME}`, args: HANDOFF_BUILD_REQUEST },
      { success: true, commandName: MUGGLE_DO_SKILL_NAME },
    ),
    toolCall(MUGGLE_TELEMETRY_SKILL_EMIT_TOOL, { skillName: MUGGLE_DO_SKILL_NAME }, mcpTextResult(TELEMETRY_EMIT_RESULT)),
  ],
  [HandoffStep.StageReads]: () =>
    stageFilesToRead().map((stagePath) =>
      toolCall("Read", { file_path: stagePath }, { type: "text", file: { filePath: stagePath } }),
    ),
  [HandoffStep.UnitTests]: () => [shellCall(UNIT_TEST_COMMAND, UNIT_TEST_OUTPUT)],
  [HandoffStep.E2eExecution]: () => [
    toolCall(
      MUGGLE_EXECUTE_REPLAY_TOOL,
      { testScriptId: E2E_TEST_SCRIPT_ID, localUrl: E2E_LOCAL_URL },
      mcpTextResult(E2E_RUN_RESULT),
    ),
  ],
  [HandoffStep.E2eSkipDeclaration]: () => [
    shellCall(`echo "${NO_WEB_SURFACE_SKIP_DECLARATION}"`, `${NO_WEB_SURFACE_SKIP_DECLARATION}\n`),
  ],
  [HandoffStep.PrCreation]: () => [shellCall(PR_CREATE_COMMAND, `${HANDOFF_PR_URL}\n`)],
  [HandoffStep.WalkthroughPost]: () => [shellCall(WALKTHROUGH_POST_COMMAND, `${WALKTHROUGH_COMMENT_URL}\n`)],
  [HandoffStep.WatcherHandoff]: watcherHandoffInteractions,
};

function handoffEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...providerFreeEnvironment(createWalkthroughProbeGhStub()),
    ...walkthroughProbeAnswerEnvironment({ branchPrUrl: "", prContentJson: PR_CONTENT_WITHOUT_WALKTHROUGH }),
    // This checkout's skills tree, not whichever installed plugin the shell running the suite points at.
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
  };
  // A host stamp inherited from that shell would make the hooks answer as Codex or Cursor.
  delete environment[HOOK_HOST_ENV_VAR];
  delete environment.CURSOR_PLUGIN_ROOT;
  return environment;
}

/** A session before its first prompt: a fresh HOME, and a fresh repo that ships no web surface. */
export function createHandoffSession(): HandoffSession {
  const repoDirectory = mkdtempSync(join(tmpdir(), "handoff-repo-"));
  writeFileSync(join(repoDirectory, "package.json"), JSON.stringify(NO_WEB_SURFACE_MANIFEST, null, 2));
  const walkthroughBodyPath = join(repoDirectory, WALKTHROUGH_BODY_FILE);
  mkdirSync(dirname(walkthroughBodyPath), { recursive: true });
  writeFileSync(walkthroughBodyPath, WALKTHROUGH_BODY);
  return {
    home: createHookHome("handoff-home-"),
    sessionId: HANDOFF_SESSION_ID,
    repoDirectory: repoDirectory,
    environment: handoffEnvironment(),
  };
}

/**
 * The same session continued in a copy of its HOME, so each case picks up from steps replayed once without
 * disturbing another case. Only safe to take between steps that start no background job, which would still be
 * writing into the original.
 */
export function cloneHandoffSession(template: HandoffSession): HandoffSession {
  const home = join(createHookHome("handoff-home-"), "home");
  cpSync(template.home, home, { recursive: true });
  return { ...template, home: home };
}

/** The steps every sequence opens with, in order. */
export function sharedStepPrefix(stepSequences: readonly (readonly HandoffStep[])[]): HandoffStep[] {
  const [firstSequence = [], ...otherSequences] = stepSequences;
  const sharedLength = firstSequence.findIndex((step, index) =>
    otherSequences.some((sequence) => sequence[index] !== step),
  );
  return firstSequence.slice(0, sharedLength < 0 ? firstSequence.length : sharedLength);
}

/** `sequence` with `omittedStep` taken out. */
export function withoutStep(sequence: readonly HandoffStep[], omittedStep: HandoffStep): HandoffStep[] {
  return sequence.filter((step) => step !== omittedStep);
}

/** `sequence` with `replacedStep` swapped, in place, for `replacement`. */
export function withStepReplaced(
  sequence: readonly HandoffStep[],
  replacedStep: HandoffStep,
  replacement: HandoffStep,
): HandoffStep[] {
  return sequence.map((step) => (step === replacedStep ? replacement : step));
}

function interactionLabel(interaction: ReplayedInteraction): string {
  if (interaction.kind === ReplayedInteractionKind.Prompt) return `prompt ${interaction.prompt}`;
  const subject = interaction.toolInput.command ?? interaction.toolInput.file_path ?? interaction.toolInput.skill ?? "";
  return `${interaction.toolName} ${String(subject)}`.trim();
}

function fireHookEvent(
  session: HandoffSession,
  slot: HookSlot,
  eventFields: Record<string, unknown>,
  eventLabel: string,
): ReplayedHookAnswer[] {
  const subcommands = guardrailSubcommandsForSlot(slot);
  if (subcommands.length === 0) return [];
  // `run` is what guardrail-dispatch.sh hands Node: every gate the event feeds, in one process, one merged answer.
  const cliRun = runGuardrailCli({
    home: session.home,
    cliArgs: ["run", ...subcommands],
    stdin: JSON.stringify({
      session_id: session.sessionId,
      cwd: session.repoDirectory,
      hook_event_name: slot.event,
      ...eventFields,
    }),
    env: session.environment,
  });
  return [{ eventLabel: `${slot.event} ${eventLabel}`, status: cliRun.status, stdout: cliRun.stdout }];
}

function replayInteraction(session: HandoffSession, interaction: ReplayedInteraction): ReplayedHookAnswer[] {
  const eventLabel = interactionLabel(interaction);
  if (interaction.kind === ReplayedInteractionKind.Prompt) {
    return fireHookEvent(session, { event: HookEvent.UserPromptSubmit }, { prompt: interaction.prompt }, eventLabel);
  }
  const toolFields = { tool_name: interaction.toolName, tool_input: interaction.toolInput };
  const preToolAnswers = fireHookEvent(
    session,
    { event: HookEvent.PreToolUse, toolName: interaction.toolName },
    toolFields,
    eventLabel,
  );
  interaction.applySideEffect?.();
  const postToolAnswers = fireHookEvent(
    session,
    { event: HookEvent.PostToolUse, toolName: interaction.toolName },
    { ...toolFields, tool_response: interaction.toolResponse },
    eventLabel,
  );
  return [...preToolAnswers, ...postToolAnswers];
}

/**
 * Replays each step through the hooks Claude Code fires for it, in order, and returns every hook command's answer.
 * Output shape: `[{ eventLabel: "PostToolUse Bash pnpm test", status: 0, stdout: "{}" }]`
 */
export function replayHandoffSteps(session: HandoffSession, steps: readonly HandoffStep[]): ReplayedHookAnswer[] {
  return steps
    .flatMap((step) => HANDOFF_STEP_INTERACTIONS[step](session))
    .flatMap((interaction) => replayInteraction(session, interaction));
}

/** Ends the turn: fires `stopGates` the way the Stop hook does, as one `run` over all of them, and returns the merged answer. */
export function fireStopGates(session: HandoffSession, stopGates: readonly string[]): GuardrailCliRun {
  return runGuardrailCli({
    home: session.home,
    cliArgs: ["run", ...stopGates],
    stdin: JSON.stringify({
      session_id: session.sessionId,
      cwd: session.repoDirectory,
      hook_event_name: HookEvent.Stop,
      stop_hook_active: false,
      last_assistant_message: HANDOFF_CLOSING_MESSAGE,
    }),
    env: session.environment,
  });
}
