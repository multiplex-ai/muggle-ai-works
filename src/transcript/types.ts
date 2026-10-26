/** One line of a Claude Code JSONL transcript, narrowed to the fields that say who wrote it. */
export interface TranscriptEntry {
  type?: string;
  /** Harness-injected text: a loaded skill's body, a hook's block reason, a re-invocation note. */
  isMeta?: boolean;
  /** The summary a compaction writes, which the model authored. */
  isCompactSummary?: boolean;
  /** A subagent's turn, whose prompt another agent wrote. */
  isSidechain?: boolean;
  /** Present on a tool result, whose text the tool or the agent produced. */
  toolUseResult?: unknown;
  /** Who started the turn: `human` for a typed or queued prompt, `task-notification` for a background event, `peer` for another agent. */
  origin?: { kind?: string };
  message?: { role?: string; content?: unknown };
}

/** One part of a message's content array. */
export interface TranscriptContentPart {
  type?: string;
  text?: unknown;
}
