/**
 * Runtime target ownership of a stored auth session.
 */

import { RuntimeTarget } from "../../../shared/runtime-target-types.js";

/**
 * Decide whether a stored session may be used for the active runtime target.
 *
 * A session carrying no target predates targets being recorded, and can only be
 * a production one: every build able to write it pointed at production.
 * @param params - Session ownership parameters.
 * @param params.storedRuntimeTarget - Target recorded on the session, if any.
 * @param params.activeRuntimeTarget - Target the harness is running as.
 * @returns True when the session belongs to the active target.
 */
export function isStoredAuthForRuntimeTarget(params: {
  storedRuntimeTarget?: RuntimeTarget;
  activeRuntimeTarget: RuntimeTarget;
}): boolean {
  if (!params.storedRuntimeTarget) {
    return params.activeRuntimeTarget === RuntimeTarget.Production;
  }
  return params.storedRuntimeTarget === params.activeRuntimeTarget;
}
