import {
  FAILURE_DIAGNOSIS_EVENT,
  MAX_DEBUG_BLOCKS,
  MUGGLE_EVENT_EMIT_TOOL,
  MUGGLE_EXECUTION_TOOL,
  MUGGLE_FEEDBACK_CREATE_TOOL,
  MUGGLE_RUN_ID_LINE,
  MUGGLE_RUN_PASSED_STATUS,
  MUGGLE_RUN_STATUS_LINE,
} from "./constants.js";
import { DebugGateAction, type DebugGateDecision, type GuardrailState, type HookInput } from "./types.js";

// muggle-test Step 7C routes every non-passing run through the debug path —
// evidence, diagnosis, and a guaranteed "give feedback & rerun" offer. It is
// marked mandatory and was still routinely skipped, so failures got summarized
// and dropped: the run the reviewer most needs to see is the one nobody looked
// at.
const DEBUG_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_DEBUG_SKIP\b/;

const serialize = (input: HookInput): string =>
  `${JSON.stringify(input.tool_input ?? {})}\n${JSON.stringify(input.tool_response ?? {})}`;

// An MCP tool's result is structured, and its shape differs by host: a plain
// string on one, an array of typed parts on another, sometimes wrapped again.
// Reading one assumed field is how a detector becomes dead code on the host
// that nests it differently, so every string in the response is flattened.
function renderedResult(toolResponse: unknown): string {
  const rendered: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") rendered.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(toolResponse);
  return rendered.join("\n");
}

/**
 * The run id of a local execution that did not pass.
 *
 * Reads the execution tool's own rendered result — the run id and verdict lines
 * it always prints — rather than guessing at a response shape the hook never
 * sees typed.
 */
export function detectFailedRunId(input: HookInput): string | undefined {
  if (!MUGGLE_EXECUTION_TOOL.test(input.tool_name ?? "")) return undefined;
  const rendered = renderedResult(input.tool_response);
  const status = MUGGLE_RUN_STATUS_LINE.exec(rendered)?.[1];
  if (!status || status.toLowerCase() === MUGGLE_RUN_PASSED_STATUS) return undefined;
  return MUGGLE_RUN_ID_LINE.exec(rendered)?.[1];
}

/** Record a failed run as owing a debug path, returning the same reference when it was already recorded. */
export function applyFailedRun(state: GuardrailState, runId: string): GuardrailState {
  if ((state.failedRuns ?? []).includes(runId)) return state;
  return { ...state, failedRuns: [...(state.failedRuns ?? []), runId] };
}

/**
 * The owed runs this call proves went through the debug path.
 *
 * Two tools count: the debug path's own `*-failure-classified`/`-resolved`
 * telemetry emit (Steps 2 and 5), and the feedback submission its
 * "give feedback & rerun" branch makes. Either one naming the run — in its
 * input or in what it returned — is the evidence.
 */
export function detectDebugEvidenceRunIds(input: HookInput, owedRunIds: string[]): string[] {
  const toolName = input.tool_name ?? "";
  const isDiagnosisEmit =
    MUGGLE_EVENT_EMIT_TOOL.test(toolName) &&
    FAILURE_DIAGNOSIS_EVENT.test(input.tool_input?.eventType ?? "");
  if (!isDiagnosisEmit && !MUGGLE_FEEDBACK_CREATE_TOOL.test(toolName)) return [];
  const payload = serialize(input);
  return owedRunIds.filter((runId) => payload.includes(runId));
}

/** Record debug-path evidence for the given runs, returning the same reference when nothing changed. */
export function applyDebugEvidence(state: GuardrailState, runIds: string[]): GuardrailState {
  const debugged = [...(state.debuggedRuns ?? [])];
  for (const runId of runIds) if (!debugged.includes(runId)) debugged.push(runId);
  if (debugged.length === (state.debuggedRuns ?? []).length) return state;
  return { ...state, debuggedRuns: debugged };
}

/** Whether a Bash command is the explicit debug-path skip declaration. */
export function isDebugSkipMarker(command: string): boolean {
  return DEBUG_SKIP_MARKER.test(command);
}

/**
 * Apply a `MUGGLE_DEBUG_SKIP: <runId> <reason>` declaration.
 *
 * The marker clears the runs it names. When it names none the gate has a run id
 * the user never saw — a studio crash before any id was rendered, a remote lane
 * with no local artifacts — so it degrades to a session-wide skip rather than
 * an escape hatch that can't be typed.
 */
export function applyDebugSkip(state: GuardrailState, command: string): GuardrailState {
  if (!isDebugSkipMarker(command)) return state;
  const namedRuns = (state.failedRuns ?? []).filter((runId) => command.includes(runId));
  if (namedRuns.length > 0) return applyDebugEvidence(state, namedRuns);
  if (state.debugSkipped === true) return state;
  return { ...state, debugSkipped: true };
}

/** The failed runs with no debug-path evidence yet. */
export function undebuggedFailedRuns(state: GuardrailState): string[] {
  const debugged = new Set(state.debuggedRuns ?? []);
  return (state.failedRuns ?? []).filter((runId) => !debugged.has(runId));
}

/**
 * Decide what the Stop hook does about failures that never reached the debug path.
 *
 * - `None`    — nothing failed, every failure has evidence, or a skip recorded.
 * - `Block`   — a failed run was summarized and dropped; hold the turn open.
 * - `Release` — blocked `maxBlocks` times already, so a failure whose evidence
 *               genuinely can't be produced can't trap the session.
 */
export function debugGateDecision(
  state: GuardrailState,
  maxBlocks: number = MAX_DEBUG_BLOCKS,
): DebugGateDecision {
  const blockCount = state.debugBlockCount ?? 0;
  const undebugged = undebuggedFailedRuns(state);
  if (state.debugSkipped === true || undebugged.length === 0) {
    return { action: DebugGateAction.None, blockCount: blockCount, undebugged: undebugged };
  }
  if (blockCount >= maxBlocks) {
    return { action: DebugGateAction.Release, blockCount: blockCount, undebugged: undebugged };
  }
  return { action: DebugGateAction.Block, blockCount: blockCount + 1, undebugged: undebugged };
}
