import * as fs from "node:fs";
import * as path from "node:path";

import { getDataDir } from "../../../../shared/data-dir.js";
import { getRunResultStorageService } from "../run-result-storage-service.js";
import {
  ACTION_SCRIPT_FILE_NAME,
  RUN_SESSIONS_DIR_NAME,
  SCREENSHOT_DIR_RELATIVE_PATH,
  SCREENSHOT_FILE_EXTENSION,
} from "./run-view-constants.js";
import type { IRunView, IRunViewStep } from "./run-view-types.js";

/** Shape the runner writes; every field is optional because a run can die mid-write. */
interface IStoredActionScript {
  actionScriptName?: string;
  status?: string;
  steps?: IStoredStep[];
  summaryStep?: IStoredStep;
}

interface IStoredStep {
  briefExplanation?: string;
  operation?: { action?: string; url?: string; screenshot?: string };
}

/** Absolute path of the directory holding one subdirectory per run. */
export function getRunSessionsDir(): string {
  return path.join(getDataDir(), RUN_SESSIONS_DIR_NAME);
}

/**
 * Thrown when a run cannot be resolved or read. Carries a message naming what was tried, so the
 * caller can print it as-is rather than a stack trace.
 */
export class RunViewError extends Error {}

const listSessionDirNames = (sessionsDir: string): string[] => {
  if (!fs.existsSync(sessionsDir)) {
    throw new RunViewError(`No runs directory at ${sessionsDir}`);
  }
  return fs
    .readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
};

/**
 * Resolve a run id to its session directory.
 *
 * Accepts a full id, or a prefix long enough to be unambiguous — a terminal is a hostile place to
 * retype a UUID. Omitting the id takes the most recently written run, which is nearly always the
 * one just watched fail.
 * @param runId - Full or partial run id; omitted takes the newest run.
 * @returns Absolute path to the session directory.
 * @throws RunViewError when nothing matches, or when a prefix matches several runs.
 */
export function resolveRunSessionPath(runId?: string): string {
  const sessionsDir = getRunSessionsDir();
  const names = listSessionDirNames(sessionsDir);

  if (names.length === 0) {
    throw new RunViewError(`No runs found under ${sessionsDir}`);
  }

  if (!runId) {
    const newest = names
      .map((name) => ({ name: name, modifiedAtMs: fs.statSync(path.join(sessionsDir, name)).mtimeMs }))
      .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)[0];
    return path.join(sessionsDir, newest.name);
  }

  const exact = names.find((name) => name === runId);
  if (exact) {
    return path.join(sessionsDir, exact);
  }

  const prefixed = names.filter((name) => name.startsWith(runId));
  if (prefixed.length === 1) {
    return path.join(sessionsDir, prefixed[0]);
  }
  if (prefixed.length > 1) {
    throw new RunViewError(
      `Run id "${runId}" matches ${prefixed.length} runs (${prefixed.slice(0, 3).join(", ")}…). Use more characters.`,
    );
  }
  throw new RunViewError(`No run matching "${runId}" under ${sessionsDir}`);
}

const listScreenshotFileNames = (sessionPath: string): string[] => {
  const screenshotDir = path.join(sessionPath, ...SCREENSHOT_DIR_RELATIVE_PATH.split("/"));
  if (!fs.existsSync(screenshotDir)) {
    return [];
  }
  return fs.readdirSync(screenshotDir).filter((name) => name.endsWith(SCREENSHOT_FILE_EXTENSION));
};

/**
 * Match a step's recorded screenshot to a file on disk.
 *
 * The action script records a runtime-relative path, while the session stores the frame under its
 * own screenshot directory — and under two naming shapes, since some frames carry a `stepNNN_`
 * prefix the recorded path does not. Matching on the recorded basename, then on any file ending
 * with it, covers both without guessing at the prefix.
 */
const resolveScreenshotPath = (
  sessionPath: string,
  screenshotFileNames: string[],
  recordedPath: string | undefined,
): string | null => {
  if (!recordedPath) {
    return null;
  }
  const recordedName = recordedPath.split(/[\\/]/).pop();
  if (!recordedName) {
    return null;
  }
  const match =
    screenshotFileNames.find((name) => name === recordedName) ??
    screenshotFileNames.find((name) => name.endsWith(recordedName));
  return match
    ? path.join(sessionPath, ...SCREENSHOT_DIR_RELATIVE_PATH.split("/"), match)
    : null;
};

/**
 * Read one run as the viewer presents it.
 *
 * Read-only throughout: nothing under the session directory is created, moved or removed.
 * @param runId - Full or partial run id; omitted takes the newest run.
 * @returns The run's steps, frames and closing verdict.
 * @throws RunViewError when the run cannot be resolved or its action script cannot be read.
 */
export function readRunView(runId?: string): IRunView {
  const sessionPath = resolveRunSessionPath(runId);
  const actionScriptPath = path.join(sessionPath, ACTION_SCRIPT_FILE_NAME);

  if (!fs.existsSync(actionScriptPath)) {
    throw new RunViewError(
      `Run ${path.basename(sessionPath)} has no ${ACTION_SCRIPT_FILE_NAME} — it died before writing one. Looked in ${sessionPath}`,
    );
  }

  let actionScript: IStoredActionScript;
  try {
    actionScript = JSON.parse(fs.readFileSync(actionScriptPath, "utf8")) as IStoredActionScript;
  } catch (parseError) {
    throw new RunViewError(
      `Could not read ${actionScriptPath}: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
    );
  }

  // The action script's own `status` describes the script, not the run: it reads "active" for a
  // run that failed. The run result is the authoritative outcome, and is absent for a run the
  // storage never recorded — in which case saying nothing beats repeating the script's word.
  const resolvedRunId = path.basename(sessionPath);
  const recordedOutcome = getRunResultStorageService().getRunResult(resolvedRunId)?.status ?? null;

  const screenshotFileNames = listScreenshotFileNames(sessionPath);
  const steps: IRunViewStep[] = (actionScript.steps ?? []).map((step, index) => ({
    index: index,
    action: step.operation?.action ?? "unknown",
    explanation: step.briefExplanation ?? "",
    screenshotPath: resolveScreenshotPath(sessionPath, screenshotFileNames, step.operation?.screenshot),
    url: step.operation?.url ?? null,
  }));

  return {
    runId: resolvedRunId,
    sessionPath: sessionPath,
    title: actionScript.actionScriptName ?? null,
    status: recordedOutcome,
    verdict: actionScript.summaryStep?.briefExplanation ?? null,
    steps: steps,
    screenshotCount: screenshotFileNames.length,
  };
}
