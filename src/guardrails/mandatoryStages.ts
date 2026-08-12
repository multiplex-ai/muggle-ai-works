import { existsSync, readFileSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
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

/** Record a read of a file in the skills tree, returning the same reference when it was already recorded. */
export function applyStageRead(state: GuardrailState, filePath: string): GuardrailState {
  const stagePath = normalizeStagePath(filePath);
  if ((state.stagesRead ?? []).includes(stagePath)) return state;
  return { ...state, stagesRead: [...(state.stagesRead ?? []), stagePath] };
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
