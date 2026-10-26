/**
 * Starts a run mid-conversation from a seeded transcript. The one place this
 * eval touches the agent SDK's alpha `sessionStore`: the SDK loads the
 * fabricated session from the store, writes it into a temporary config
 * directory with copied credentials, and resumes the CLI there — so nothing
 * is written to the real `~/.claude`, and the temporary directory is removed
 * when the run ends.
 */

import { randomUUID } from "node:crypto";

import type { SessionStore } from "@anthropic-ai/claude-agent-sdk";

import { TRANSCRIPT_START_OFFSET_MS } from "../constants.js";
import type { TranscriptResume, TranscriptResumeRequest } from "../types.js";
import { buildTranscriptEntries } from "./entries.js";
import { fillTranscriptPaths, materializeTranscript, transcriptPathsByToken } from "./materialize.js";

/**
 * Materialize the transcript into the run's sandbox and return what the run
 * passes to `query()`: the resume prompt as its prompt, plus `resume` and a
 * `sessionStore` that serves the fabricated session.
 *
 * The SDK refuses a `sessionStore` beside `persistSession: false`, so a
 * resumed run leaves persistence on; the session it persists lands in the
 * SDK's temporary config directory.
 *
 * @throws when the transcript cannot be materialized (see `materializeTranscript`).
 */
export function resumeFromSeedTranscript(request: TranscriptResumeRequest): TranscriptResume {
  const { paths, pluginRoot } = request.context;
  const sessionId = randomUUID();
  const turns = materializeTranscript(request.transcript, request.context);
  const entries = buildTranscriptEntries(request.firstUserMessage, turns, {
    sessionId: sessionId,
    cwd: paths.repo,
    model: request.model,
    startedAt: new Date(Date.now() - TRANSCRIPT_START_OFFSET_MS),
  });
  const sessionStore: SessionStore = {
    // The CLI mirrors the resumed session back as it runs; nothing reads it.
    append: async () => undefined,
    load: async (key) => (key.sessionId === sessionId && key.subpath === undefined ? entries : null),
  };
  const resumePrompt = fillTranscriptPaths(request.transcript.resumePrompt, transcriptPathsByToken(paths, pluginRoot));
  return { prompt: resumePrompt, queryOptions: { resume: sessionId, sessionStore: sessionStore } };
}
