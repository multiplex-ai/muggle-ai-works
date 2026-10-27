import { MUGGLE_DO_COMMAND_NAMES, MUGGLE_PLUGIN_NAMESPACE } from "./constants.js";

const BUILD = /\b(implement|build|add|create|write|fix|refactor|wire up|hook up|make (a|the|it)|change the)\b/i;
// muggle-do also owns conflict-resolution and driving a PR to green — intents
// the BUILD verbs miss. Length bound keeps unrelated phrasings from matching.
const DEVCYCLE = /\bresolve\b[^.?!]{0,40}\bconflicts?\b|\bget\b[^.?!]{0,40}\bpr\b[^.?!]{0,40}\b(green|merged?|passing)\b/i;
const QUESTION = /^\s*(why|what|how|when|where|who|is|are|does|do|can you (explain|tell)|explain)\b/i;

// `/mdo …`, `/muggle:muggle-do …`, or Codex's `$muggle:muggle-do …`: a sigil, an
// optional plugin namespace, the command name, then its arguments.
const SKILL_COMMAND = /^[/$](?:([\w-]+):)?([\w-]+)(?:\s+([\s\S]*))?$/;
const MENU_ARGUMENTS = /^(help|menu|\?)?$/i;

// muggle-do's programmatic modes: a directive on a PR/MR that already exists, or
// cleanup of a session slot after merge. Neither opens a PR, so none is owed.
const CHANGE_URL = /https?:\/\/\S+\/(pull\/\d+|-\/merge_requests\/\d+)/i;
const CHANGE_DIRECTIVE = /\b(address[\s-]reviews|fix[\s-]ci|rebase|resolve[\s-]conflicts)\b/i;
const CLEANUP_DIRECTIVE = /\bcleanup\b/i;
const SESSION_SLOT_ARGUMENT = /(^|\s)slug=\S/;

/** Whether a natural-language prompt asks to build, fix, or drive a change through the dev cycle; slash commands and questions never do. */
export function detectBuildIntent(prompt: string): boolean {
  const p = (prompt ?? "").trim();
  if (!p || p.startsWith("/")) return false;
  if (QUESTION.test(p)) return false;
  return BUILD.test(p) || DEVCYCLE.test(p);
}

/**
 * Whether a prompt invokes muggle-do's forward pipeline by command.
 *
 * Any alias or namespace form counts. The menu forms and the programmatic modes
 * the watcher dispatches do not: those never open a PR, so a session that ran
 * one owes nothing to the build follow-through gate.
 */
export function isMuggleDoForwardInvocation(prompt: string): boolean {
  const command = SKILL_COMMAND.exec((prompt ?? "").trim());
  if (!command) return false;
  const [, namespace, commandName, rawArguments] = command;
  if (namespace !== undefined && namespace.toLowerCase() !== MUGGLE_PLUGIN_NAMESPACE) return false;
  if (!MUGGLE_DO_COMMAND_NAMES.includes(commandName.toLowerCase())) return false;
  const commandArguments = (rawArguments ?? "").trim();
  if (MENU_ARGUMENTS.test(commandArguments)) return false;
  const isChangeDirective = CHANGE_URL.test(commandArguments) && CHANGE_DIRECTIVE.test(commandArguments);
  const isCleanupDirective = CLEANUP_DIRECTIVE.test(commandArguments) && SESSION_SLOT_ARGUMENT.test(commandArguments);
  return !isChangeDirective && !isCleanupDirective;
}
