import { closeSync, fstatSync, openSync, readSync } from "fs";
import { SESSION_FILE_HEAD_BYTES, SESSION_FILE_TAIL_BYTES } from "./constants.js";

/** The enum member equal to `candidate`, or undefined for anything else — external JSON is never trusted to match. */
export function enumValueOf<T extends string>(values: Record<string, T>, candidate: unknown): T | undefined {
  return Object.values(values).find((value) => value === candidate);
}

/** `candidate` when it is a non-empty string, otherwise undefined. */
export function optionalString(candidate: unknown): string | undefined {
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

/**
 * The first `SESSION_FILE_HEAD_BYTES` of a file as UTF-8, or undefined when it cannot be read.
 * Session metadata sits on a transcript's first lines, and the files themselves run to megabytes.
 */
export function readFileHead(filePath: string): string | undefined {
  let fileDescriptor: number | undefined;
  try {
    fileDescriptor = openSync(filePath, "r");
    const buffer = Buffer.alloc(SESSION_FILE_HEAD_BYTES);
    const bytesRead = readSync(fileDescriptor, buffer, 0, SESSION_FILE_HEAD_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString("utf-8");
  } catch {
    return undefined;
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
  }
}

/** The last `SESSION_FILE_TAIL_BYTES` of a file as UTF-8, or undefined when it cannot be read. Its first line may be cut. */
export function readFileTail(filePath: string): string | undefined {
  let fileDescriptor: number | undefined;
  try {
    fileDescriptor = openSync(filePath, "r");
    const fileSize = fstatSync(fileDescriptor).size;
    const length = Math.min(fileSize, SESSION_FILE_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fileDescriptor, buffer, 0, length, fileSize - length);
    return buffer.subarray(0, bytesRead).toString("utf-8");
  } catch {
    return undefined;
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
  }
}

/** The first JSON-escaped `"cwd": "…"` value in a session file's head, decoded. */
export function cwdFromSessionHead(head: string): string | undefined {
  const parts = head.match(/"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/);
  if (!parts) return undefined;
  try {
    return optionalString(JSON.parse(parts[1]));
  } catch {
    return undefined;
  }
}
