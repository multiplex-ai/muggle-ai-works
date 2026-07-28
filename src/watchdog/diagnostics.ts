import { INTERNAL_DIAGNOSTICS_ENV_VAR } from "./constants.js";

export function internalDiagnosticsEnabled(): boolean {
  return process.env[INTERNAL_DIAGNOSTICS_ENV_VAR] === "1";
}
