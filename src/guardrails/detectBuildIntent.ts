const BUILD = /\b(implement|build|add|create|write|fix|refactor|wire up|hook up|make (a|the|it)|change the)\b/i;
// muggle-do also owns conflict-resolution and driving a PR to green — intents
// the BUILD verbs miss. Length bound keeps unrelated phrasings from matching.
const DEVCYCLE = /\bresolve\b[^.?!]{0,40}\bconflicts?\b|\bget\b[^.?!]{0,40}\bpr\b[^.?!]{0,40}\b(green|merged?|passing)\b/i;
const QUESTION = /^\s*(why|what|how|when|where|who|is|are|does|do|can you (explain|tell)|explain)\b/i;

export function detectBuildIntent(prompt: string): boolean {
  const p = (prompt ?? "").trim();
  if (!p || p.startsWith("/")) return false;
  if (QUESTION.test(p)) return false;
  return BUILD.test(p) || DEVCYCLE.test(p);
}
