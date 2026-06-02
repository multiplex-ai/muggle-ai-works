import { readFileSync } from "fs";
import { readState, markPrHandled } from "./sessionState.js";
import { detectPrOpened } from "./prOpened.js";
import { envelope, type Host } from "./emit.js";
import type { HookInput } from "./types.js";

function readStdin(): HookInput {
  try {
    return JSON.parse(readFileSync(0, "utf-8")) as HookInput;
  } catch {
    return {};
  }
}

const host: Host = process.env.CURSOR_PLUGIN_ROOT ? "cursor" : "claude";
const sub = process.argv[2];
const input = readStdin();
const sessionId = input.session_id ?? "unknown";

function prOpened(): string {
  const url = detectPrOpened(input);
  if (!url) return "{}";
  if (readState(sessionId).prsHandled.includes(url)) return "{}";
  markPrHandled(sessionId, url);
  const ctx =
    `A pull request was just opened: ${url}\n` +
    `Per the autoWatchPR preference, a muggle-pr-followup watcher should handle its incoming reviews. ` +
    `If autoWatchPR=always, start it now by invoking /muggle:muggle-pr-followup with the PR URL; ` +
    `if =ask, offer it to the user; if =never, do nothing.`;
  return envelope("PostToolUse", ctx, host);
}

const handlers: Record<string, () => string> = { "pr-opened": prOpened };
process.stdout.write((handlers[sub] ?? (() => "{}"))());
