import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { extname, join } from "path";
import {
  BUILD_OUTPUT_ENTRY,
  BUNDLED_SOURCE_ROOTS,
  COLOCATED_TEST_PATTERN,
  REPO_ROOT,
  RUNNABLE_SOURCE_EXTENSIONS,
  UNSHIPPED_DIRECTORY_NAMES,
} from "./constants.js";

function runnableFilesUnder(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) {
    const isRunnable = RUNNABLE_SOURCE_EXTENSIONS.includes(extname(path)) && !COLOCATED_TEST_PATTERN.test(path);
    return isRunnable ? [path] : [];
  }
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && UNSHIPPED_DIRECTORY_NAMES.includes(entry.name)) return [];
    return runnableFilesUnder(join(path, entry.name));
  });
}

/**
 * Every runnable file a user receives: each `package.json` `files` entry except the build output, plus the workspace
 * sources that build output is bundled from. Tests and fixtures are left out.
 * @returns Absolute paths, each once.
 */
export function shippedSourceFiles(): string[] {
  const packageManifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as { files: string[] };
  const publishedEntries = packageManifest.files
    .filter((entry) => entry !== BUILD_OUTPUT_ENTRY)
    .map((entry) => join(REPO_ROOT, entry));
  return [...new Set([...publishedEntries, ...BUNDLED_SOURCE_ROOTS].flatMap(runnableFilesUnder))];
}
