import { resolveHookHost } from "../guardrails/hookHost.js";
import { WATCH_QOS_RECORD_FLAGS } from "./constants.js";
import { watchQosHostOfHookHost } from "./host.js";
import { prReferenceOf } from "./identity.js";
import { recordWatchQosObservation } from "./recorder.js";
import { WatchQosDetector, WatchQosSignal } from "./types.js";

function flagValue(argv: string[], flag: string): string | undefined {
  const flagIndex = argv.indexOf(flag);
  const flagArgument = flagIndex === -1 ? undefined : argv[flagIndex + 1];
  return flagArgument === undefined || flagArgument === "" || flagArgument.startsWith("--") ? undefined : flagArgument;
}

function enumValueOf<T extends Record<string, string>>(enumObject: T, candidate: string | undefined): T[keyof T] | undefined {
  return (Object.values(enumObject) as Array<T[keyof T]>).find((enumValue) => enumValue === candidate);
}

// The watch loop's record entry: `watch-qos-record.mjs --signal <s> --detector <d> --repo <o/r> --pr <n> [--head <sha>]
// [--occurrence <key>]`. It only appends to the local ledger and always exits 0, so a loop never stops over a record.
const argv = process.argv.slice(2);
const signal = enumValueOf(WatchQosSignal, flagValue(argv, WATCH_QOS_RECORD_FLAGS.signal));
const detector = enumValueOf(WatchQosDetector, flagValue(argv, WATCH_QOS_RECORD_FLAGS.detector));
const repo = flagValue(argv, WATCH_QOS_RECORD_FLAGS.repo);
const prNumber = flagValue(argv, WATCH_QOS_RECORD_FLAGS.pr);
if (signal !== undefined && detector !== undefined && repo !== undefined && prNumber !== undefined) {
  recordWatchQosObservation({
    signal: signal,
    detector: detector,
    prReference: prReferenceOf(repo, prNumber),
    headSha: flagValue(argv, WATCH_QOS_RECORD_FLAGS.head),
    host: watchQosHostOfHookHost(resolveHookHost()),
    occurrenceKey: flagValue(argv, WATCH_QOS_RECORD_FLAGS.occurrence),
  });
}
