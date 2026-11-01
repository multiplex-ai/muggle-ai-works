import { nameFlagOf } from "./claude-jobs.js";
import { CLAUDE_PROMPT_NAME_MAX_LENGTH, LIMIT_RESUME_PROMPT } from "./constants.js";
import type { SessionNameSources } from "./types.js";

/**
 * Whether a session's shown name is one a restart forced on it rather than its
 * own: the short id a respawn falls back to, or a prompt the watch resumed it
 * on (its continue message, or a slash command such as an owner wake).
 */
export function isPlaceholderSessionName(name: string | undefined, shortId: string): boolean {
  return name === undefined || name === shortId || name === LIMIT_RESUME_PROMPT || name.startsWith("/");
}

/**
 * The name a session should keep across a restart, recovered from what it was
 * already called — never a new one: the user's latest `/rename`, the `--name`
 * it was started with, the name it shows now unless a restart forced it, or
 * else the opening prompt Claude named it after. Undefined when none of these
 * is a real name.
 *
 * Output shape: `"convert starter to pro campaign"`
 */
export function resolveSessionName(sources: SessionNameSources): string | undefined {
  // Claude names a session it was given no name for after its opening prompt, cut to the same length.
  const promptName = sources.job?.intent?.replace(/\s+/g, " ").trim().slice(0, CLAUDE_PROMPT_NAME_MAX_LENGTH);
  const candidates = [sources.customTitle, sources.job && nameFlagOf(sources.job.respawnFlags), sources.registeredName, promptName];
  return candidates.find((candidate) => !isPlaceholderSessionName(candidate, sources.shortId));
}
