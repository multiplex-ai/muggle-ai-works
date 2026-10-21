/**
 * Resolve whether a local generation run clears browser session state first.
 * An explicit caller value wins; otherwise the test case's stored flag applies.
 *
 * @param params.requestedFreshSession - Value the caller passed, if any.
 * @param params.storedAlwaysStartsFreshSession - Flag stored on the cloud test case, if any.
 */
export function resolveEffectiveFreshSession(params: {
  requestedFreshSession: boolean | undefined;
  storedAlwaysStartsFreshSession: boolean | undefined;
}): boolean | undefined {
  return params.requestedFreshSession ?? params.storedAlwaysStartsFreshSession;
}
