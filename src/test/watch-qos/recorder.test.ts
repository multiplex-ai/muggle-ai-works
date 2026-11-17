import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { WATCH_QOS_LEDGER_DISABLED_VALUE, WATCH_QOS_LEDGER_ENV_VAR } from "../../watch-qos/constants.js";
import { hashWatchQosIdentity, prReferenceOf, prReferenceOfUrl, resolveWatchQosSalt } from "../../watch-qos/identity.js";
import { readWatchQosRecords, resolveWatchQosPaths } from "../../watch-qos/ledger.js";
import { ciRedObservedAtMs, recordWatchQosObservation, toWatchQosLedgerRecord } from "../../watch-qos/recorder.js";
import { WatchQosDetector, WatchQosHost, WatchQosSignal, type WatchQosObservation } from "../../watch-qos/types.js";

const HEAD = "1111111111111111111111111111111111111111";

const observation: WatchQosObservation = {
  signal: WatchQosSignal.CiRedObserved,
  detector: WatchQosDetector.WatchLoop,
  prReference: "octo/repo#7",
  headSha: HEAD,
  host: WatchQosHost.ClaudeCode,
};

function freshPaths() {
  return resolveWatchQosPaths(join(mkdtempSync(join(tmpdir(), "watch-qos-recorder-")), "telemetry"));
}

beforeEach(() => {
  vi.stubEnv(WATCH_QOS_LEDGER_ENV_VAR, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("watch QoS identity", () => {
  it("spells a PR as owner/repo#n from its parts or its GitHub URL, and keeps any other URL as is", () => {
    expect(prReferenceOf("octo/repo", 7)).toBe("octo/repo#7");
    expect(prReferenceOfUrl("https://github.com/octo/repo/pull/7")).toBe("octo/repo#7");
    expect(prReferenceOfUrl("https://gitlab.com/octo/repo/-/merge_requests/7")).toBe("https://gitlab.com/octo/repo/-/merge_requests/7");
  });

  it("hashes per install: stable under one salt, different under another, never the identity itself", () => {
    const hashed = hashWatchQosIdentity("octo/repo#7", "install-a");
    expect(hashed).toBe(hashWatchQosIdentity("octo/repo#7", "install-a"));
    expect(hashed).not.toBe(hashWatchQosIdentity("octo/repo#7", "install-b"));
    expect(hashed).toMatch(/^[0-9a-f]{32}$/);
    expect(hashed).not.toContain("octo");
  });
});

describe("toWatchQosLedgerRecord", () => {
  it("hashes the PR and head and rounds the delay to whole non-negative seconds", () => {
    const record = toWatchQosLedgerRecord({ ...observation, delaySeconds: 12.6 }, "salt", Date.parse("2026-11-17T10:00:00Z"));
    expect(record).toEqual({
      at: "2026-11-17T10:00:00.000Z",
      signal: WatchQosSignal.CiRedObserved,
      detector: WatchQosDetector.WatchLoop,
      subjectId: hashWatchQosIdentity("octo/repo#7", "salt"),
      headId: hashWatchQosIdentity(HEAD, "salt"),
      delaySeconds: 13,
      host: WatchQosHost.ClaudeCode,
      occurrenceKey: undefined,
    });
    expect(toWatchQosLedgerRecord({ ...observation, delaySeconds: -4 }, "salt", 0).delaySeconds).toBe(0);
  });
});

describe("recordWatchQosObservation", () => {
  it("appends the hashed record once, salted with the install id", () => {
    const paths = freshPaths();
    expect(recordWatchQosObservation(observation, Date.now(), paths)).toBe(true);
    expect(recordWatchQosObservation(observation, Date.now(), paths)).toBe(false);
    const [record] = readWatchQosRecords(paths);
    expect(record.subjectId).toBe(hashWatchQosIdentity("octo/repo#7", resolveWatchQosSalt()));
  });

  it("writes nothing while the ledger is switched off", () => {
    vi.stubEnv(WATCH_QOS_LEDGER_ENV_VAR, WATCH_QOS_LEDGER_DISABLED_VALUE);
    const paths = freshPaths();
    expect(recordWatchQosObservation(observation, Date.now(), paths)).toBe(false);
    expect(readWatchQosRecords(paths)).toEqual([]);
  });
});

describe("ciRedObservedAtMs", () => {
  it("returns when the head was first observed red, or undefined when it never was", () => {
    const paths = freshPaths();
    const observedAtMs = Date.parse("2026-11-17T10:00:00Z");
    recordWatchQosObservation(observation, observedAtMs, paths);
    expect(ciRedObservedAtMs("octo/repo#7", HEAD, paths)).toBe(observedAtMs);
    expect(ciRedObservedAtMs("octo/repo#8", HEAD, paths)).toBeUndefined();
  });
});
