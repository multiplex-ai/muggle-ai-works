import type { GuardrailState } from "./types.js";

export function shouldRunE2E(state: GuardrailState): boolean {
  return state.unitTestsGreen === true && state.e2eRun !== true;
}
