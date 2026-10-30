import { E2E_SKIP_CODES } from "../e2e-skip/constants.js";
import { E2eSkipCode } from "../e2e-skip/types.js";
import { ALWAYS_PREFERENCE_VALUE } from "../pr-watch/constants.js";
import { AUTO_E2E_TEST_PREFERENCE_KEY, POST_PR_VISUAL_WALKTHROUGH_PREFERENCE_KEY } from "./constants.js";
import type { E2eOwedReasonInput } from "./types.js";

const describePreference = (preferenceKey: string, configuredValue: string | undefined): string =>
  `${preferenceKey}=${configuredValue ?? "unset"}`;

/**
 * The instruction the e2e Stop gate blocks the turn with, worded from the user's resolved preferences.
 *
 * When the user's own file sets `autoE2ETest=always`, the preference is their answer, so the reason forbids asking
 * or handing the decision back and offers only the verifiable environment skip codes — never the unverified-judgment
 * escape, which is how an `always` run was written off as "not worth it" before. `postPRVisualWalkthrough=always`
 * adds the walkthrough post to the mandated steps.
 *
 * Output shape: `Do not end the turn yet. … autoE2ETest=always, postPRVisualWalkthrough=always … run /muggle:muggle-test …`
 */
export function buildE2eOwedReason(input: E2eOwedReasonInput): string {
  const isE2eMandated = input.isE2eMandatedByUser;
  const isWalkthroughMandated = input.postPRVisualWalkthrough === ALWAYS_PREFERENCE_VALUE;
  const preferenceSummary =
    `${describePreference(AUTO_E2E_TEST_PREFERENCE_KEY, input.autoE2ETest)}, ` +
    `${describePreference(POST_PR_VISUAL_WALKTHROUGH_PREFERENCE_KEY, input.postPRVisualWalkthrough)} ` +
    `(~/.muggle-ai/preferences.json)`;
  const walkthroughStep = isWalkthroughMandated
    ? `, then post the run's walkthrough to the PR via ${input.walkthroughSkill}`
    : "";
  const offeredSkipCodes = isE2eMandated
    ? E2E_SKIP_CODES.filter((skipCode) => skipCode !== E2eSkipCode.NotApplicable)
    : E2E_SKIP_CODES;
  const skipClause =
    `To skip, run \`echo "MUGGLE_E2E_SKIP: <CODE>: <detail>"\` citing one of ${offeredSkipCodes.join(", ")}. ` +
    `Muggle verifies each code itself, so one that does not hold leaves this gate blocked.`;

  if (input.blockCount > 1) {
    return (
      `E2E acceptance run still owed (reminder ${input.blockCount}/${input.maxBlocks}; ${preferenceSummary}): ` +
      `run ${input.muggleTestSkill}${walkthroughStep}, or cite a verifiable code via ` +
      `\`echo "MUGGLE_E2E_SKIP: <CODE>: <detail>"\`.`
    );
  }
  const owedSentence =
    `Do not end the turn yet. This session went unit-green or opened a PR, but no E2E acceptance run has happened. ` +
    `Preferences: ${preferenceSummary}. `;
  if (isE2eMandated) {
    return (
      owedSentence +
      `That is the user's standing answer: do not ask them whether to test, and do not end the turn handing the ` +
      `decision back. Run change-driven E2E now via ${input.muggleTestSkill}${walkthroughStep}, then finish. ` +
      `${skipClause} A judgment that the change is not worth a run is not a skip.`
    );
  }
  return (
    owedSentence +
    `Run change-driven E2E now via ${input.muggleTestSkill}${walkthroughStep}, then finish. ${skipClause} ` +
    `Only when no verifiable code fits and a browser run genuinely cannot exercise the change, cite ` +
    `${E2eSkipCode.NotApplicable} with the reason — the PR shows it as your unverified judgment.`
  );
}
