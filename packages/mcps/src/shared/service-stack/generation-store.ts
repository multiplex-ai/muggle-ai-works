/**
 * Lock-free, optimistic store for one small JSON record shared by processes on
 * this machine.
 *
 * Every state is an immutable, numbered generation file. A writer reads the
 * newest generation, decides the next record, and commits it by linking a
 * fully written pending file to the next generation's name. The link fails when
 * any other writer committed first; the loser re-reads and decides again. No
 * writer ever waits on another, and there is no mutex for a crashed writer to
 * strand — it leaves at most an orphaned pending file, swept on a later commit.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  COMMIT_RETRY_JITTER_MS,
  GENERATION_DIGITS,
  GENERATION_FILE_PREFIX,
  GENERATION_FILE_SUFFIX,
  GENERATIONS_KEPT,
  MAX_COMMIT_ATTEMPTS,
  PENDING_FILE_PREFIX,
} from "./generation-store-constants.js";
import type {
  IGenerationSnapshot,
  IGenerationUpdate,
  IGenerationUpdateOutcome,
} from "./generation-store-types.js";

/**
 * Read the newest committed record.
 *
 * @param params.directory - Directory holding the store's generation files.
 * @param params.emptyRecord - Record to report when nothing was committed, or the newest file is unreadable.
 * @returns The record and the generation it was read at.
 */
export async function readGenerationStore<TRecord>(params: {
  directory: string;
  emptyRecord: TRecord;
}): Promise<IGenerationSnapshot<TRecord>> {
  for (;;) {
    const newest = (await listGenerations(params.directory)).at(-1);
    if (newest === undefined) return { generation: 0, record: params.emptyRecord };
    try {
      const raw = await fs.readFile(path.join(params.directory, generationFileName(newest)), "utf-8");
      return { generation: newest, record: JSON.parse(raw) as TRecord };
    } catch (error) {
      // Pruned between listing and reading: a newer generation exists, so list again.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      // A commit links only complete files, so this is outside damage; the next commit heals it.
      if (error instanceof SyntaxError) return { generation: newest, record: params.emptyRecord };
      throw error;
    }
  }
}

/**
 * Read, decide and commit until the decision lands on the generation it was
 * made against.
 *
 * `decide` must be pure: it can run several times when other writers race.
 *
 * @param params.directory - Directory holding the store's generation files.
 * @param params.emptyRecord - Record `decide` sees when nothing was committed.
 * @param params.decide - Maps the current record to the next one (null = no write) and the caller's result.
 * @returns The last decision's result, and whether its record was committed.
 */
export async function updateGenerationStore<TRecord, TResult>(params: {
  directory: string;
  emptyRecord: TRecord;
  decide: (snapshot: IGenerationSnapshot<TRecord>) => IGenerationUpdate<TRecord, TResult>;
}): Promise<IGenerationUpdateOutcome<TResult>> {
  let lastDecision: { generation: number; result: TResult } | null = null;
  for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
    const snapshot = await readGenerationStore({ directory: params.directory, emptyRecord: params.emptyRecord });
    const update = params.decide(snapshot);
    if (update.next === null) {
      return { isCommitted: true, generation: snapshot.generation, result: update.result };
    }
    const isCommitted = await commitGeneration({
      directory: params.directory,
      expectedGeneration: snapshot.generation,
      record: update.next,
    });
    if (isCommitted) {
      return { isCommitted: true, generation: snapshot.generation + 1, result: update.result };
    }
    lastDecision = { generation: snapshot.generation, result: update.result };
    await sleep(Math.random() * COMMIT_RETRY_JITTER_MS);
  }
  if (lastDecision === null) throw new Error("generation store made no attempt");
  return { isCommitted: false, generation: lastDecision.generation, result: lastDecision.result };
}

/**
 * Commit `record` as the generation after `expectedGeneration`. The pending
 * file is complete before it is linked, so a reader never sees a partial
 * record, and the link fails when another writer took that generation first.
 */
async function commitGeneration(params: {
  directory: string;
  expectedGeneration: number;
  record: unknown;
}): Promise<boolean> {
  await fs.mkdir(params.directory, { recursive: true });
  const nextGeneration = params.expectedGeneration + 1;
  const pendingPath = path.join(params.directory, `${PENDING_FILE_PREFIX}${process.pid}-${randomUUID()}.json`);
  await fs.writeFile(pendingPath, JSON.stringify(params.record, null, 2), "utf-8");
  try {
    await fs.link(pendingPath, path.join(params.directory, generationFileName(nextGeneration)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await fs.unlink(pendingPath).catch(() => undefined);
  }
  await pruneGenerations({ directory: params.directory, newestGeneration: nextGeneration });
  return true;
}

async function pruneGenerations(params: { directory: string; newestGeneration: number }): Promise<void> {
  const fileNames = await fs.readdir(params.directory).catch(() => [] as string[]);
  const oldestKept = params.newestGeneration - GENERATIONS_KEPT;
  await Promise.all(
    fileNames.map(async (fileName) => {
      const generation = parseGenerationFileName(fileName);
      const isOldGeneration = generation !== null && generation < oldestKept;
      if (isOldGeneration || isOrphanedPendingFile(fileName)) {
        await fs.unlink(path.join(params.directory, fileName)).catch(() => undefined);
      }
    }),
  );
}

// A pending file outlives its write only when the writer died between the
// write and the unlink; its pid names the writer.
function isOrphanedPendingFile(fileName: string): boolean {
  if (!fileName.startsWith(PENDING_FILE_PREFIX)) return false;
  const writerPid = Number(fileName.slice(PENDING_FILE_PREFIX.length).split("-")[0]);
  return Number.isInteger(writerPid) && writerPid !== process.pid && !isProcessAlive(writerPid);
}

async function listGenerations(directory: string): Promise<number[]> {
  try {
    return (await fs.readdir(directory))
      .map((fileName) => parseGenerationFileName(fileName))
      .filter((generation): generation is number => generation !== null)
      .sort((left, right) => left - right);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function generationFileName(generation: number): string {
  return GENERATION_FILE_PREFIX + String(generation).padStart(GENERATION_DIGITS, "0") + GENERATION_FILE_SUFFIX;
}

function parseGenerationFileName(fileName: string): number | null {
  if (!fileName.startsWith(GENERATION_FILE_PREFIX) || !fileName.endsWith(GENERATION_FILE_SUFFIX)) return null;
  const digits = fileName.slice(GENERATION_FILE_PREFIX.length, fileName.length - GENERATION_FILE_SUFFIX.length);
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

/**
 * Whether a process id is still running on this machine. `EPERM` counts as
 * alive: the process exists but belongs to another user.
 *
 * @param pid - Process id to probe.
 * @returns True while the process exists.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
