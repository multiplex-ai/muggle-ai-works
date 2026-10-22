import { UNPASSED_STATUS_EMOJI } from "./constants.js";
import { UnpassedCaseStatus, type IUnpassedCase } from "./types.js";

/** Escape text placed inside HTML, so an agent's `<…>` cannot break the markup around it. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape text placed inside a double-quoted HTML attribute, so a `"` cannot end the attribute early. */
export function escapeHtmlAttribute(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/**
 * Why a case did not pass, as one markdown-safe phrase.
 *
 * Output shape: `failed at step 3: Element not found` / `inconclusive: No replayable script`
 */
function describeUnpassedCase(unpassed: IUnpassedCase): string {
  const outcome =
    unpassed.status === UnpassedCaseStatus.Failed && unpassed.failedStep !== undefined
      ? `failed at step ${unpassed.failedStep}`
      : unpassed.status;
  return `${outcome}: ${escapeHtml(unpassed.detail)}`;
}

/**
 * One markdown bullet naming a non-passing case and why, ending in a link the
 * caller picks — an in-page anchor on the walkthrough, the run on the dashboard
 * in a check summary.
 *
 * Output shape: `- ❌ **Checkout** — failed at step 4: Pay button disabled · [open run](https://…)`
 */
export function renderUnpassedCaseBullet(unpassed: IUnpassedCase, linkText: string, linkTarget: string): string {
  return (
    `- ${UNPASSED_STATUS_EMOJI[unpassed.status]} **${escapeHtml(unpassed.name)}** — ` +
    `${describeUnpassedCase(unpassed)} · [${linkText}](${linkTarget})`
  );
}
