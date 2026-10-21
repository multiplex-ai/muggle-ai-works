/** Creates, seeds, inspects, and removes one run's sandbox directory. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  CLAUDE_CONFIG_DIR_ENV,
  CLAUDE_PROJECTS_DIRNAME,
  DEFAULT_CLAUDE_CONFIG_DIRNAME,
  FIXTURE_REPOS_DIR,
  SANDBOX_DIR_PREFIX,
} from "../constants.js";
import type {
  ArtifactExpectation,
  ArtifactSnapshot,
  RunSandbox,
  SandboxPathContext,
  ScenarioSeed,
} from "../types.js";
import { isInsideDirectory, resolveSandboxPath } from "./paths.js";

/**
 * The fixture repository a seed names, as an absolute directory.
 *
 * @throws when the name is not a directory directly under `fixturesDir`.
 */
export function resolveFixtureRepo(repoName: string, fixturesDir: string = FIXTURE_REPOS_DIR): string {
  const repoDir = path.resolve(fixturesDir, repoName);
  if (path.dirname(repoDir) !== path.resolve(fixturesDir) || !fs.statSync(repoDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`seed.repo "${repoName}" is not a fixture directory under ${fixturesDir}`);
  }
  return repoDir;
}

/**
 * The sandbox plus the real home directory it stands in for.
 *
 * @param passthroughRoots - Real directories that keep their paths under the real home, such as the plugin tree.
 */
export function sandboxPathContext(sandbox: RunSandbox, passthroughRoots: string[] = []): SandboxPathContext {
  return { ...sandbox, realHome: os.homedir(), passthroughRoots: passthroughRoots };
}

/**
 * Make a fresh sandbox: an empty home, the seed's fixture repository copied in
 * as the repo (or an empty repo), then the seed's files written over both.
 *
 * Output shape: `{ root: "<tmp>/muggle-agent-eval-run-XXXX", home: "<root>/home", repo: "<root>/repo" }`
 *
 * @throws when a seed file's path resolves outside the sandbox home and repo.
 */
export function createRunSandbox(seed?: ScenarioSeed, fixturesDir: string = FIXTURE_REPOS_DIR): RunSandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_DIR_PREFIX));
  const sandbox: RunSandbox = { root: root, home: path.join(root, "home"), repo: path.join(root, "repo") };
  try {
    fs.mkdirSync(sandbox.home);
    if (seed?.repo) {
      fs.cpSync(resolveFixtureRepo(seed.repo, fixturesDir), sandbox.repo, { recursive: true });
    } else {
      fs.mkdirSync(sandbox.repo);
    }
    const paths = sandboxPathContext(sandbox);
    for (const seedFile of seed?.files ?? []) {
      const target = resolveSandboxPath(seedFile.path, paths);
      const isInHomeOrRepo = isInsideDirectory(sandbox.home, target) || isInsideDirectory(sandbox.repo, target);
      if (path.isAbsolute(seedFile.path) || !isInHomeOrRepo) {
        throw new Error(`seed file "${seedFile.path}" must be ~/… or relative, inside the sandbox home or repo`);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, seedFile.content);
    }
  } catch (error) {
    removeRunSandbox(sandbox);
    throw error;
  }
  return sandbox;
}

/** Read each expected artifact's sandbox file, or null where none exists. */
export function snapshotArtifacts(
  artifacts: ArtifactExpectation[],
  paths: SandboxPathContext,
): ArtifactSnapshot {
  const fileContents: Record<string, string | null> = {};
  for (const artifact of artifacts) {
    const filePath = resolveSandboxPath(artifact.path, paths);
    fileContents[artifact.path] = fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()
      ? fs.readFileSync(filePath, "utf8")
      : null;
  }
  return { paths: paths, fileContents: fileContents };
}

/**
 * Where the Claude Code CLI keeps per-project records for the sandbox repo:
 * `<config dir>/projects/<repo path, each non-alphanumeric as "-">`.
 */
export function sandboxSessionRecordsDir(sandbox: RunSandbox): string {
  const configDir = process.env[CLAUDE_CONFIG_DIR_ENV] ?? path.join(os.homedir(), DEFAULT_CLAUDE_CONFIG_DIRNAME);
  return path.join(configDir, CLAUDE_PROJECTS_DIRNAME, sandbox.repo.replace(/[^A-Za-z0-9]/g, "-"));
}

/**
 * Delete the sandbox, everything the run wrote into it, and the records the
 * CLI keeps for its working directory — a title line and a memory dir it
 * writes even with session persistence off, one directory per run otherwise.
 */
export function removeRunSandbox(sandbox: RunSandbox): void {
  fs.rmSync(sandbox.root, { recursive: true, force: true, maxRetries: 3 });
  fs.rmSync(sandboxSessionRecordsDir(sandbox), { recursive: true, force: true, maxRetries: 3 });
}
