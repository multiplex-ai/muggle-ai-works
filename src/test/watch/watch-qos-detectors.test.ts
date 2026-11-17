import { describe, expect, it } from "vitest";
import { ProviderPrState } from "../../guardrails/types.js";
import { CI_RED_RESPONSE_WINDOW_MS } from "../../watch-qos/constants.js";
import { WatchQosDetector, WatchQosHost, WatchQosSignal } from "../../watch-qos/types.js";
import { deriveWatchQosObservations, watchQosHostsBySessionId } from "../../watch/watch-qos-detectors.js";
import { deriveWatchFindings, reconcileActiveFindings } from "../../watch/findings.js";
import {
  CiRollupState,
  OwnerEscalationKind,
  WatcherLiveness,
  WorkSessionAgent,
  type FindingTransitions,
  type WatchQosTickInput,
  type WatchSlotAssessment,
} from "../../watch/types.js";

const NOW_MS = Date.parse("2026-11-17T12:00:00Z");
const HEAD = "abcdef0123";
const OWNER = "owner-123456789";

function assessment(overrides: Partial<WatchSlotAssessment> = {}): WatchSlotAssessment {
  return {
    slug: "csv",
    slotDir: "/s/csv",
    pr: { repo: "o/r", number: 7, url: "https://github.com/o/r/pull/7" },
    isRegistered: true,
    watcher: WatcherLiveness.Polling,
    ownerSessionId: OWNER,
    isOwnerSessionActive: true,
    isHeardByService: false,
    live: { url: "https://github.com/o/r/pull/7", state: ProviderPrState.Open, headSha: HEAD, unresolvedThreadCount: 0 },
    ...overrides,
  };
}

const redLive = (state: ProviderPrState = ProviderPrState.Open) => ({
  url: "https://github.com/o/r/pull/7",
  state: state,
  headSha: HEAD,
  ciRollup: CiRollupState.Failure,
  unresolvedThreadCount: 0,
});

const noTransitions: FindingTransitions = { activeFindings: {}, raised: [], cleared: [] };

function tickInput(overrides: Partial<WatchQosTickInput>): WatchQosTickInput {
  return {
    assessments: [],
    lastSeenJsonBySlotDir: new Map(),
    transitions: noTransitions,
    hostBySessionId: new Map(),
    nowMs: NOW_MS,
    ciRedObservedAtMs: () => undefined,
    ...overrides,
  };
}

function signalsOf(input: WatchQosTickInput): WatchQosSignal[] {
  return deriveWatchQosObservations(input).map((observation) => observation.signal);
}

const lastSeenFor = (entry: object) => new Map([["/s/csv", JSON.stringify({ "o/r#7": entry })]]);

describe("deriveWatchQosObservations — watchers", () => {
  it("records a dead watcher's raise as watcher-down with its heartbeat age", () => {
    const dead = assessment({ watcher: WatcherLiveness.Dead, heartbeatAgeMs: 600_000 });
    const transitions = reconcileActiveFindings({}, deriveWatchFindings([dead], [], false), new Date(NOW_MS).toISOString());
    const [observation] = deriveWatchQosObservations(tickInput({ assessments: [dead], transitions: transitions }));
    expect(observation).toMatchObject({
      signal: WatchQosSignal.WatcherDown,
      detector: WatchQosDetector.WatchService,
      prReference: "o/r#7",
      delaySeconds: 600,
    });
  });

  it("records the clear as watcher-recovered with the time it was down, while the PR is open and heard again", () => {
    const downAt = new Date(NOW_MS - 300_000).toISOString();
    const raised = reconcileActiveFindings({}, deriveWatchFindings([assessment({ watcher: WatcherLiveness.Dead })], [], false), downAt);
    const healed = assessment();
    const transitions = reconcileActiveFindings(raised.activeFindings, deriveWatchFindings([healed], [], false), new Date(NOW_MS).toISOString());
    const [observation] = deriveWatchQosObservations(tickInput({ assessments: [healed], transitions: transitions }));
    expect(observation).toMatchObject({ signal: WatchQosSignal.WatcherRecovered, delaySeconds: 300 });
  });

  it("does not take a watcher finding cleared by the PR going terminal as a recovery", () => {
    const raised = reconcileActiveFindings({}, deriveWatchFindings([assessment({ watcher: WatcherLiveness.Dead })], [], false), "t0");
    const merged = assessment({ watcher: WatcherLiveness.Dead, live: { ...redLive(ProviderPrState.Merged), ciRollup: CiRollupState.Success } });
    const transitions = reconcileActiveFindings(raised.activeFindings, deriveWatchFindings([merged], [], false), "t1");
    expect(signalsOf(tickInput({ assessments: [merged], transitions: transitions }))).toEqual([]);
  });

  it("tells two outages of one watcher apart", () => {
    const dead = assessment({ watcher: WatcherLiveness.Dead });
    const transitions = reconcileActiveFindings({}, deriveWatchFindings([dead], [], false), "t0");
    const first = deriveWatchQosObservations(tickInput({ assessments: [dead], transitions: transitions }))[0];
    const second = deriveWatchQosObservations(tickInput({ assessments: [dead], transitions: transitions, nowMs: NOW_MS + 1 }))[0];
    expect(first.occurrenceKey).not.toBe(second.occurrenceKey);
  });
});

describe("deriveWatchQosObservations — red CI on an open PR", () => {
  it("observes a red head and holds within the response window", () => {
    expect(signalsOf(tickInput({ assessments: [assessment({ live: redLive() })], ciRedObservedAtMs: () => NOW_MS - 60_000 }))).toEqual([
      WatchQosSignal.CiRedObserved,
    ]);
  });

  it("flags a red head nothing acted on past the window as late, with how long it has been red", () => {
    const observations = deriveWatchQosObservations(
      tickInput({ assessments: [assessment({ live: redLive() })], ciRedObservedAtMs: () => NOW_MS - CI_RED_RESPONSE_WINDOW_MS - 60_000 }),
    );
    expect(observations.map((observation) => observation.signal)).toEqual([WatchQosSignal.CiRedObserved, WatchQosSignal.CiRedLate]);
    expect(observations[1]).toMatchObject({ headSha: HEAD, delaySeconds: CI_RED_RESPONSE_WINDOW_MS / 1000 + 60 });
  });

  it("records a fix attempt as handled, with the time to handle, never late", () => {
    const observations = deriveWatchQosObservations(
      tickInput({
        assessments: [assessment({ live: redLive() })],
        lastSeenJsonBySlotDir: lastSeenFor({ ci_fix_attempts: { [HEAD]: 1 } }),
        ciRedObservedAtMs: () => NOW_MS - CI_RED_RESPONSE_WINDOW_MS * 2,
      }),
    );
    expect(observations.map((observation) => observation.signal)).toEqual([WatchQosSignal.CiRedObserved, WatchQosSignal.CiRedHandled]);
    expect(observations[1].delaySeconds).toBe((CI_RED_RESPONSE_WINDOW_MS * 2) / 1000);
  });

  it("counts a repair wait and an owner escalation as handled", () => {
    const longRed = () => NOW_MS - CI_RED_RESPONSE_WINDOW_MS * 2;
    const waiting = tickInput({
      assessments: [assessment({ live: redLive() })],
      lastSeenJsonBySlotDir: lastSeenFor({ ci_wait: { head_sha: HEAD, reason: "quota", retry_at: "2026-11-17T13:00:00Z" } }),
      ciRedObservedAtMs: longRed,
    });
    const escalated = tickInput({
      assessments: [assessment({ live: redLive(), ownerEscalation: { kinds: [OwnerEscalationKind.Ci] } })],
      ciRedObservedAtMs: longRed,
    });
    expect(signalsOf(waiting)).toContain(WatchQosSignal.CiRedHandled);
    expect(signalsOf(escalated)).toContain(WatchQosSignal.CiRedHandled);
  });

  it("does not count an owner escalation of something other than CI", () => {
    const input = tickInput({
      assessments: [assessment({ live: redLive(), ownerEscalation: { kinds: [OwnerEscalationKind.Reviews] } })],
      ciRedObservedAtMs: () => NOW_MS - CI_RED_RESPONSE_WINDOW_MS * 2,
    });
    expect(signalsOf(input)).toContain(WatchQosSignal.CiRedLate);
  });

  it("does not count an escalation entry with no attempt behind it", () => {
    const input = tickInput({
      assessments: [assessment({ live: redLive() })],
      lastSeenJsonBySlotDir: lastSeenFor({ ci_escalated_shas: [HEAD] }),
      ciRedObservedAtMs: () => NOW_MS - CI_RED_RESPONSE_WINDOW_MS * 2,
    });
    expect(signalsOf(input)).toContain(WatchQosSignal.CiRedLate);
  });

  it("ignores a green head", () => {
    expect(signalsOf(tickInput({ assessments: [assessment()] }))).toEqual([]);
  });
});

describe("deriveWatchQosObservations — terminal PRs", () => {
  it("records a PR merged with its last head red and nothing covering it as merged-red", () => {
    const [observation] = deriveWatchQosObservations(tickInput({ assessments: [assessment({ live: redLive(ProviderPrState.Merged) })] }));
    expect(observation).toMatchObject({ signal: WatchQosSignal.MergedRed, headSha: HEAD, prReference: "o/r#7" });
  });

  it("records a closed one as closed-red", () => {
    expect(signalsOf(tickInput({ assessments: [assessment({ live: redLive(ProviderPrState.Closed) })] }))).toEqual([WatchQosSignal.ClosedRed]);
  });

  it("records nothing when a fix attempt covered the red head", () => {
    const input = tickInput({
      assessments: [assessment({ live: redLive(ProviderPrState.Merged) })],
      lastSeenJsonBySlotDir: lastSeenFor({ ci_fix_attempts: { [HEAD]: 2 } }),
    });
    expect(signalsOf(input)).toEqual([]);
  });

  it("judges nothing from a cached terminal status, which carries no head", () => {
    const cached = assessment({ live: { url: "u", state: ProviderPrState.Merged, unresolvedThreadCount: 0 } });
    expect(signalsOf(tickInput({ assessments: [cached] }))).toEqual([]);
  });
});

describe("watch QoS host", () => {
  it("takes the owner session's agent, and Claude Code when the owner is not listed", () => {
    const hosts = watchQosHostsBySessionId([{ agent: WorkSessionAgent.Codex, sessionId: OWNER }]);
    const [codexOwned] = deriveWatchQosObservations(
      tickInput({ assessments: [assessment({ live: redLive(ProviderPrState.Merged) })], hostBySessionId: hosts }),
    );
    const [unlisted] = deriveWatchQosObservations(tickInput({ assessments: [assessment({ live: redLive(ProviderPrState.Merged) })] }));
    expect(codexOwned.host).toBe(WatchQosHost.Codex);
    expect(unlisted.host).toBe(WatchQosHost.ClaudeCode);
  });
});
