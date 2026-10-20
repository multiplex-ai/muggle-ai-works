import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  FILE_PRINTING_PROGRAMS,
  MANDATORY_STAGES_FRONTMATTER_KEY,
  MAX_STAGE_BLOCKS,
  SKILL_NAME_INPUT_KEYS,
} from "./constants.js";
import { StageGateAction, type GuardrailState, type StageGateDecision, type ToolInput } from "./types.js";

// A skill's SKILL.md is the router; the files it links to are the steps that
// make it correct. Nothing forced those links to be opened, so a skill read as
// a single page silently lost its mandatory steps — the failure this gate
// exists for. The declaration is explicit frontmatter rather than parsed prose:
// a gate that guesses which links matter blocks on the wrong ones.
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const SEQUENCE_ENTRY = /^\s*-\s*(.+?)\s*$/;
const FLOW_LIST = /^\s*\[(.*)\]\s*$/;

// A deliberate "the stages don't apply here" declaration:
// `echo "MUGGLE_STAGE_SKIP: <reason>"`. Anchored to a leading echo like every
// other marker, so a grep or a skill edit that mentions the token can't disarm
// the gate.
const STAGE_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_STAGE_SKIP\b/;

const SKILLS_DIR_NAME = "skills";
const SKILLS_PATH_SEGMENT = `/${SKILLS_DIR_NAME}/`;
const SINGLE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;

// The characters of the separators that start a new command: `a && b`, `a; b`, `a | b`, a newline.
const SHELL_COMMAND_SEPARATOR = /[;&|\n]/;
const SHELL_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
const SHELL_VARIABLE_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const MARKDOWN_FILE = /\.md$/i;

const unquote = (raw: string): string => raw.trim().replace(/^["']|["']$/g, "").trim();

/**
 * The stage paths a SKILL.md declares, exactly as written.
 *
 * Reads only the frontmatter block, so the same key appearing in the body — a
 * doc explaining the mechanism, for instance — is not a declaration. Accepts
 * both YAML list forms.
 *
 * Output shape: `["../_shared/failure-mode-handling.md"]`
 */
export function parseDeclaredStages(skillMarkdown: string): string[] {
  const frontmatter = FRONTMATTER.exec(skillMarkdown)?.[1];
  if (!frontmatter) return [];
  const lines = frontmatter.split(/\r?\n/);
  const keyIndex = lines.findIndex((line) =>
    line.startsWith(`${MANDATORY_STAGES_FRONTMATTER_KEY}:`),
  );
  if (keyIndex < 0) return [];

  const inlineValue = lines[keyIndex].slice(MANDATORY_STAGES_FRONTMATTER_KEY.length + 1).trim();
  const flowEntries = FLOW_LIST.exec(inlineValue)?.[1];
  if (flowEntries !== undefined) {
    return flowEntries
      .split(",")
      .map(unquote)
      .filter((entry) => entry.length > 0);
  }

  const declared: string[] = [];
  for (const line of lines.slice(keyIndex + 1)) {
    const entry = SEQUENCE_ENTRY.exec(line);
    if (!entry) break;
    declared.push(unquote(entry[1]));
  }
  return declared;
}

/** One comparable form for a filesystem path, so a stage declared with backslashes still matches the read that opened it. */
export function normalizeStagePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").toLowerCase();
}

/** The stage's path inside the skills tree, which is how the skill's own links name it. */
export function stageLabel(normalizedStagePath: string): string {
  const insideSkills = normalizedStagePath.lastIndexOf(SKILLS_PATH_SEGMENT);
  if (insideSkills < 0) return normalizedStagePath;
  return normalizedStagePath.slice(insideSkills + SKILLS_PATH_SEGMENT.length);
}

/** The plugin's own skills tree, from the root the host exports to every hook; falls back to this module's install location. */
export function resolvePluginSkillsRoot(): string {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || process.env.CURSOR_PLUGIN_ROOT;
  if (pluginRoot) return join(pluginRoot, SKILLS_DIR_NAME);
  return join(dirname(dirname(fileURLToPath(import.meta.url))), SKILLS_DIR_NAME);
}

/**
 * The invoked skill's name, normalized to the directory that holds its SKILL.md.
 *
 * Plugin skills arrive namespaced (`muggle:muggle-test`) and slash-command
 * invocations may keep the leading slash. Anything that isn't a single path
 * segment after that is rejected rather than resolved — the name goes straight
 * into a filesystem lookup.
 */
export function resolveSkillNameFromToolInput(toolInput: ToolInput | undefined): string | undefined {
  if (!toolInput) return undefined;
  const indexed = toolInput as Record<string, unknown>;
  for (const inputKey of SKILL_NAME_INPUT_KEYS) {
    const value = indexed[inputKey];
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const skillName = value.trim().split(":").pop()?.replace(/^\//, "") ?? "";
    return SINGLE_PATH_SEGMENT.test(skillName) ? skillName : undefined;
  }
  return undefined;
}

/**
 * The absolute, normalized stage files a skill declares.
 *
 * Declarations resolve against the skill directory, so both `../_shared/x.md`
 * (the form the skill's own links use) and `_shared/x.md` land on the same
 * file. A declaration that escapes the skills tree, or names a file that isn't
 * there, is dropped — a gate must never block on a path it can't point at.
 */
export function resolveSkillStagePaths(skillName: string, skillsRootDir: string): string[] {
  const skillDir = join(skillsRootDir, skillName);
  const skillFile = join(skillDir, "SKILL.md");
  if (!existsSync(skillFile)) return [];

  const normalizedRoot = normalizeStagePath(skillsRootDir);
  const staysInsideSkillsTree = (candidate: string): boolean =>
    normalizeStagePath(candidate).startsWith(`${normalizedRoot}/`);

  const resolved: string[] = [];
  for (const declared of parseDeclaredStages(readFileSync(skillFile, "utf-8"))) {
    if (isAbsolute(declared)) continue;
    const stagePath = [resolve(skillDir, declared), resolve(skillsRootDir, declared)].find(
      (candidate) => staysInsideSkillsTree(candidate) && existsSync(candidate),
    );
    if (!stagePath) continue;
    const normalized = normalizeStagePath(stagePath);
    if (!resolved.includes(normalized)) resolved.push(normalized);
  }
  return resolved;
}

/** Record which skill is running and what it declared, returning the same reference when nothing changed so the caller can skip a redundant write. */
export function applySkillInvocation(
  state: GuardrailState,
  skillName: string,
  stagePaths: string[],
): GuardrailState {
  const merged = [...(state.mandatoryStages ?? [])];
  for (const stagePath of stagePaths) if (!merged.includes(stagePath)) merged.push(stagePath);
  if (state.lastInvokedSkillName === skillName && merged.length === (state.mandatoryStages?.length ?? 0)) {
    return state;
  }
  return { ...state, lastInvokedSkillName: skillName, mandatoryStages: merged };
}

/** Whether a path is a markdown file inside a skills tree — the only place a mandatory stage lives. */
export function isSkillTreeMarkdown(filePath: string): boolean {
  const normalized = normalizeStagePath(filePath);
  return normalized.includes(SKILLS_PATH_SEGMENT) && MARKDOWN_FILE.test(normalized);
}

/** Record a read of a file in the skills tree, returning the same reference when it was already recorded. */
export function applyStageRead(state: GuardrailState, filePath: string): GuardrailState {
  const stagePath = normalizeStagePath(filePath);
  if ((state.stagesRead ?? []).includes(stagePath)) return state;
  return { ...state, stagesRead: [...(state.stagesRead ?? []), stagePath] };
}

// A backslash escapes only the characters the shell gives meaning to, so a
// Windows path (`C:\Users\…`) keeps its separators.
const SHELL_ESCAPABLE_UNQUOTED = new Set([" ", "\t", "'", '"', "\\", "$", ";", "&", "|", "\n"]);
const SHELL_ESCAPABLE_DOUBLE_QUOTED = new Set(['"', "\\", "$", "`"]);

/**
 * A shell command split into its simple commands, each as its words with quotes removed.
 *
 * A best-effort reading, not a shell: quotes group words and separators split
 * commands, which is all a stage-read check needs. Substitutions and
 * redirections pass through as ordinary words.
 *
 * Output shape: `splitShellCommands("cd /p && cat 'a b.md'")` → `[["cd", "/p"], ["cat", "a b.md"]]`
 */
function splitShellCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let wordStarted = false;
  let quote: string | null = null;
  const endWord = (): void => {
    if (wordStarted) words.push(word);
    word = "";
    wordStarted = false;
  };
  const endCommand = (): void => {
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

// An unset variable expands to nothing, as the shell expands it, so the path is
// the one the command actually opened.
function expandShellWord(word: string, variables: Record<string, string | undefined>): string {
  const withHome = word === "~" || word.startsWith("~/") ? `${homedir()}${word.slice(1)}` : word;
  return withHome.replace(
    SHELL_VARIABLE_REFERENCE,
    (_reference, bracedName: string | undefined, bareName: string | undefined) =>
      variables[bracedName ?? bareName ?? ""] ?? "",
  );
}

function resolveShellPath(path: string, workingDirectory: string): string {
  return isAbsolute(path) || WINDOWS_ABSOLUTE_PATH.test(path) ? path : resolve(workingDirectory, path);
}

/**
 * The skill-tree markdown files a shell command prints, as normalized paths.
 *
 * A host with no Read tool opens a stage file through the shell — Codex runs
 * `cat`, `sed -n` or `head` on it — so the stage gate has to see those reads
 * too, or it holds the turn open over files that were read. Paths resolve
 * against the command's working directory, following any `cd` earlier in the
 * same command, and expand the variables the hook inherited
 * (`$CLAUDE_PLUGIN_ROOT`, `$HOME`) or an earlier `NAME=value` in the command
 * set. Only markdown under a `skills/` directory is returned: a read anywhere
 * else is not a stage.
 *
 * Output shape: `["/home/u/.codex/plugins/cache/muggle-works/muggle/5.18.0/skills/_shared/debug-failed-run.md"]`
 */
export function detectShellStageReads(
  command: string,
  cwd: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const variables: Record<string, string | undefined> = { ...env };
  let workingDirectory = cwd ?? process.cwd();
  const readPaths: string[] = [];
  for (const words of splitShellCommands(command)) {
    let programIndex = 0;
    const assignments: Array<[string, string]> = [];
    for (; programIndex < words.length; programIndex += 1) {
      const assignment = SHELL_ASSIGNMENT.exec(words[programIndex]);
      if (!assignment) break;
      assignments.push([assignment[1], expandShellWord(assignment[2], variables)]);
    }
    const programWord = words[programIndex];
    // `NAME=value` alone (or under `export`) sets the variable for the rest of the
    // command; in front of a program it only reaches that program's environment,
    // never the expansion of its own arguments.
    if (programWord === undefined || programWord === "export") {
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
    if (!(FILE_PRINTING_PROGRAMS as readonly string[]).includes(program)) continue;
    for (const argument of argumentWords) {
      if (argument.startsWith("-") || !MARKDOWN_FILE.test(argument)) continue;
      const readPath = normalizeStagePath(resolveShellPath(argument, workingDirectory));
      if (isSkillTreeMarkdown(readPath) && !readPaths.includes(readPath)) readPaths.push(readPath);
    }
  }
  return readPaths;
}

/** The declared stages this session never opened. */
export function unreadMandatoryStages(state: GuardrailState): string[] {
  const read = new Set(state.stagesRead ?? []);
  return (state.mandatoryStages ?? []).filter((stagePath) => !read.has(stagePath));
}

/** Whether a Bash command is the explicit mandatory-stage skip declaration. */
export function isStageSkipMarker(command: string): boolean {
  return STAGE_SKIP_MARKER.test(command);
}

/** Record a mandatory-stage skip, returning the same reference when nothing changed. */
export function applyStageSkip(state: GuardrailState, skipped: boolean): GuardrailState {
  if (!skipped || state.stageSkipped === true) return state;
  return { ...state, stageSkipped: true };
}

/**
 * Decide what the Stop hook does about unread mandatory stages.
 *
 * - `None`    — nothing declared, everything read, or a skip recorded.
 * - `Block`   — a declared stage was never opened; hold the turn open.
 * - `Release` — blocked `maxBlocks` times already, so a stage that genuinely
 *               can't be read (a stale declaration, a file the host can't
 *               reach) can't trap the session.
 */
export function stageGateDecision(
  state: GuardrailState,
  unreadStagePaths: string[],
  maxBlocks: number = MAX_STAGE_BLOCKS,
): StageGateDecision {
  const blockCount = state.stageBlockCount ?? 0;
  if (state.stageSkipped === true || unreadStagePaths.length === 0) {
    return { action: StageGateAction.None, blockCount: blockCount, unread: unreadStagePaths };
  }
  if (blockCount >= maxBlocks) {
    return { action: StageGateAction.Release, blockCount: blockCount, unread: unreadStagePaths };
  }
  return { action: StageGateAction.Block, blockCount: blockCount + 1, unread: unreadStagePaths };
}
