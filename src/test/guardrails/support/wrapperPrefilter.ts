import { readFileSync } from "fs";
import { join } from "path";
import { FIELDS_PREFILTER_CALL, PAYLOAD_PREFILTER_CALL, PLUGIN_SCRIPTS_DIR, POSIX_SPACE_CLASS } from "./constants.js";
import type { WrapperPrefilter } from "./types.js";

const toJavaScriptPattern = (bashPattern: string): RegExp =>
  new RegExp(bashPattern.replaceAll(POSIX_SPACE_CLASS, "\\s"), "i");

/** The first `"<name>": "<string>"` in a payload's JSON text, still escaped, as guardrail_payload_field reads it. */
function payloadFieldValue(payloadJson: string, fieldName: string): string | undefined {
  return new RegExp(`"${fieldName}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(payloadJson)?.[1];
}

/**
 * The pre-filter a gate wrapper applies, read out of the wrapper and matched the way guardrail-lib.sh matches it:
 * `guardrail_payload_matches` over the whole payload, `guardrail_fields_match` over the named fields joined with a
 * space. A wrapper holding several calls is read as their OR, which is how every wrapper combines them; state checks
 * are not modelled.
 * @throws When the wrapper holds no payload pre-filter.
 */
export function wrapperPayloadPrefilter(wrapperScriptName: string): WrapperPrefilter {
  const wrapperBody = readFileSync(join(PLUGIN_SCRIPTS_DIR, wrapperScriptName), "utf-8");
  const payloadArms = [...wrapperBody.matchAll(PAYLOAD_PREFILTER_CALL)].map(([, pattern]) => {
    const payloadPattern = toJavaScriptPattern(pattern);
    return (payloadJson: string): boolean => payloadPattern.test(payloadJson);
  });
  const fieldArms = [...wrapperBody.matchAll(FIELDS_PREFILTER_CALL)].map(([, fieldList, pattern]) => {
    const fieldNames = fieldList.trim().split(/\s+/);
    const fieldsPattern = toJavaScriptPattern(pattern);
    return (payloadJson: string): boolean => {
      const haystack = fieldNames
        .map((fieldName) => payloadFieldValue(payloadJson, fieldName))
        .filter((value) => value !== undefined)
        .map((value) => ` ${value}`)
        .join("");
      return fieldsPattern.test(haystack);
    };
  });
  const arms = [...payloadArms, ...fieldArms];
  if (arms.length === 0) throw new Error(`${wrapperScriptName} has no payload pre-filter`);
  return { test: (payloadJson) => arms.some((arm) => arm(payloadJson)) };
}
