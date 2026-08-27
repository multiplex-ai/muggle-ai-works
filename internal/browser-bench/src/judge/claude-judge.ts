import type Anthropic from "@anthropic-ai/sdk";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  JUDGE_IMAGE_MEDIA_TYPES,
  JUDGE_MAX_TOKENS,
  JUDGE_MODEL,
} from "./constants";

type JudgeContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

const resolveMediaType = (screenshotPath: string): string =>
  JUDGE_IMAGE_MEDIA_TYPES[path.extname(screenshotPath).toLowerCase()] ??
  JUDGE_IMAGE_MEDIA_TYPES[".png"];

/**
 * Builds the judge's message content: the scoring prompt, then every screenshot
 * in capture order.
 *
 * The whole trajectory is sent rather than a trailing slice — WebVoyager's judge
 * sees the run, and truncating it would score a different protocol than the one
 * the number is reported against. Task step count is capped, so the image count
 * is bounded by that cap rather than by the run's length.
 *
 * Output shape: `[{ type: "text", text: "…" }, { type: "image", source: {…} }]`
 *
 * @param params.readAsBase64 - Injected so the block shape is testable without disk.
 */
export const buildJudgeContentBlocks = ({
  prompt,
  screenshotPaths,
  readAsBase64,
}: {
  prompt: string;
  screenshotPaths: string[];
  readAsBase64: (screenshotPath: string) => string;
}): JudgeContentBlock[] => [
  { type: "text", text: prompt },
  ...screenshotPaths.map(
    (screenshotPath): JudgeContentBlock => ({
      type: "image",
      source: {
        type: "base64",
        media_type: resolveMediaType(screenshotPath),
        data: readAsBase64(screenshotPath),
      },
    }),
  ),
];

/**
 * Builds the judge seam `judgeTaskAsync` calls, backed by a real vision model.
 *
 * A refusal or a truncated reply throws rather than returning text. Both come
 * back as an HTTP 200 that the WebVoyager protocol would read as "no SUCCESS
 * line" — scoring the attempt a capability failure when the judge simply never
 * rendered a verdict. Raising sends it to the orchestrator's infrastructure
 * bucket, which is excluded from the pass-rate rather than counted against the
 * agent.
 *
 * Output shape: `"The agent reached the recipe page…\nStatus: SUCCESS"`
 *
 * @param params.client - An authenticated Anthropic client.
 */
export const createClaudeJudgeInvoker = ({
  client,
  readAsBase64 = (screenshotPath: string): string =>
    fs.readFileSync(screenshotPath).toString("base64"),
}: {
  client: Anthropic;
  readAsBase64?: (screenshotPath: string) => string;
}): ((prompt: string, screenshotPaths: string[]) => Promise<string>) => {
  return async (prompt, screenshotPaths) => {
    const response = await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: JUDGE_MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: buildJudgeContentBlocks({
            prompt: prompt,
            screenshotPaths: screenshotPaths,
            readAsBase64: readAsBase64,
          }) as Anthropic.MessageParam["content"],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new Error(
        `Judge refused to score the attempt (category ${response.stop_details?.category ?? "unknown"}).`,
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error(
        `Judge hit max_tokens before rendering a verdict; raise JUDGE_MAX_TOKENS (currently ${JUDGE_MAX_TOKENS}).`,
      );
    }

    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  };
};
