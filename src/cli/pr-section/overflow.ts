/**
 * All-or-nothing overflow split for the PR body evidence block.
 *
 * If the full inline body fits within the byte budget, return it as-is with no comment.
 * Otherwise, move the collapsible failure-details tier into a follow-up comment and
 * replace them in the body with a single pointer line.
 *
 * "Budget" is UTF-8 byte length, not character length: GitHub's PR body limit is
 * byte-based, and markdown can contain multibyte characters.
 */

import { renderBody, renderComment } from "./render.js";
import type { E2eReport } from "./types.js";

export interface ISplitOptions {
  /** Maximum UTF-8 byte length of the rendered body. */
  maxBodyBytes: number;
}

export interface ISplitResult {
  /** Markdown to paste into the PR description. */
  body: string;
  /** Markdown to post as a follow-up comment, or null if no overflow happened. */
  comment: string | null;
}

/**
 * Decide whether the evidence block fits in the PR body, and return the right split.
 */
export function splitWithOverflow (
  report: E2eReport,
  opts: ISplitOptions,
): ISplitResult {
  const inlineBody = renderBody(report, { inlineFailureDetails: true });
  const inlineBytes = Buffer.byteLength(inlineBody, "utf-8");
  if (inlineBytes <= opts.maxBodyBytes) {
    return { body: inlineBody, comment: null };
  }
  const spilledBody = renderBody(report, { inlineFailureDetails: false });
  const comment = renderComment(report);
  return {
    body: spilledBody,
    comment: comment.length > 0 ? comment : null,
  };
}
