import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { CLAUDE_JOB_STATE_FILE_NAME, SESSION_NAME_FLAG } from "./constants.js";
import { optionalString } from "./field-parsers.js";
import type { ClaudeJobRecord } from "./types.js";

function jobStatePath(jobsDir: string, shortId: string): string {
  return join(jobsDir, shortId, CLAUDE_JOB_STATE_FILE_NAME);
}

function readJobState(statePath: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf-8")) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function respawnFlagsOf(state: Record<string, unknown>): string[] {
  return Array.isArray(state.respawnFlags) ? state.respawnFlags.filter((flag): flag is string => typeof flag === "string") : [];
}

/** The name a job's `respawnFlags` gives its session, or undefined when they give none. */
export function nameFlagOf(respawnFlags: string[]): string | undefined {
  const flagIndex = respawnFlags.lastIndexOf(SESSION_NAME_FLAG);
  return flagIndex === -1 ? undefined : optionalString(respawnFlags[flagIndex + 1]);
}

/**
 * Claude's record of the background job a session runs as, or undefined when
 * there is none or it cannot be read.
 *
 * Output shape: `{ respawnFlags: ["--agent", "claude", "--name", "deploy agent"], intent: "Deploy the …" }`
 */
export function readClaudeJob(jobsDir: string, shortId: string): ClaudeJobRecord | undefined {
  const state = readJobState(jobStatePath(jobsDir, shortId));
  if (state === undefined) return undefined;
  const intent = optionalString(state.intent);
  return { respawnFlags: respawnFlagsOf(state), ...(intent === undefined ? {} : { intent: intent }) };
}

/**
 * Make `name` the one `--name` in a job's `respawnFlags`, leaving every other
 * field as Claude wrote it. A restart or resume rebuilds the session from those
 * flags, so the name holds across both; without one Claude names the session
 * after its short id or the prompt it is resumed on.
 *
 * @returns Whether the record now names the session `name`.
 */
export function pinClaudeJobName(jobsDir: string, shortId: string, name: string): boolean {
  const statePath = jobStatePath(jobsDir, shortId);
  const state = readJobState(statePath);
  if (state === undefined) return false;
  const respawnFlags = respawnFlagsOf(state);
  if (nameFlagOf(respawnFlags) === name) return true;
  const otherFlags = respawnFlags.filter((flag, index) => flag !== SESSION_NAME_FLAG && respawnFlags[index - 1] !== SESSION_NAME_FLAG);
  try {
    writeFileSync(statePath, JSON.stringify({ ...state, respawnFlags: [...otherFlags, SESSION_NAME_FLAG, name] }, null, 2));
    return true;
  } catch {
    return false;
  }
}
