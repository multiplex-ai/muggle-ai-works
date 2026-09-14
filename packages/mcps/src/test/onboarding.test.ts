/**
 * Tests for the first-run onboarding service.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  DEFAULT_PREFERENCES,
  PREFERENCE_ALLOWED_VALUES,
  PREFERENCES_FILE_NAME,
} from "../shared/preferences-constants.js";
import { PreferenceKey, PreferenceValue } from "../shared/preferences-types.js";
import {
  ONBOARDING_MAX_OFFERS,
  ONBOARDING_PRIMER_BULLETS,
  ONBOARDING_PRIMER_HEADLINE,
} from "../shared/onboarding/onboarding-constants.js";
import {
  OnboardingBlanketChoice,
  OnboardingGroupKind,
} from "../shared/onboarding/onboarding-types.js";
import {
  applyOnboardingAnswers,
  buildOnboardingPlan,
  completeOnboarding,
  getOnboardingToggleKeys,
  markOnboardingCompleted,
  needsOnboarding,
  recordOnboardingSkip,
  resolveBlanketPreferences,
  resolveOnboardingAnswers,
  resolveTogglePreferences,
} from "../shared/onboarding/onboarding-service.js";

let dataDir: string;

function preferencesPath(): string {
  return path.join(dataDir, PREFERENCES_FILE_NAME);
}

function readFile(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(preferencesPath(), "utf-8")) as Record<string, unknown>;
}

function seedFile(contents: Record<string, unknown>): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(preferencesPath(), JSON.stringify(contents, null, 2), "utf-8");
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-onboarding-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("needsOnboarding", () => {
  it("is true when no preferences file exists", () => {
    expect(needsOnboarding(dataDir)).toBe(true);
  });

  it("is true when preferences were seeded but nobody was ever asked", () => {
    seedFile({ version: 1, preferences: DEFAULT_PREFERENCES });
    expect(needsOnboarding(dataDir)).toBe(true);
  });

  it("is false once a completion stamp is present", () => {
    seedFile({ version: 1, preferences: {}, onboardingCompletedAt: "2026-01-01T00:00:00.000Z" });
    expect(needsOnboarding(dataDir)).toBe(false);
  });

  it("is true when the stamp is present but empty", () => {
    seedFile({ version: 1, preferences: {}, onboardingCompletedAt: "" });
    expect(needsOnboarding(dataDir)).toBe(true);
  });
});

describe("buildOnboardingPlan", () => {
  const plan = buildOnboardingPlan();

  it("carries the primer copy", () => {
    expect(plan.primerHeadline).toBe(ONBOARDING_PRIMER_HEADLINE);
    expect(plan.primerBullets).toEqual([...ONBOARDING_PRIMER_BULLETS]);
  });

  it("covers every preference key exactly once", () => {
    const covered = plan.groups.flatMap((group) =>
      group.kind === OnboardingGroupKind.Toggle
        ? group.entries.map((entry) => entry.key)
        : [group.key],
    );

    expect(covered).toHaveLength(Object.values(PreferenceKey).length);
    expect([...covered].sort()).toEqual([...Object.values(PreferenceKey)].sort());
  });

  it("only offers values the key allows", () => {
    for (const group of plan.groups) {
      if (group.kind !== OnboardingGroupKind.Choice) {
        continue;
      }
      for (const option of group.options) {
        expect(PREFERENCE_ALLOWED_VALUES[group.key]).toContain(option.value);
      }
    }
  });

  it("pre-selects exactly one option per choice group", () => {
    for (const group of plan.groups) {
      if (group.kind !== OnboardingGroupKind.Choice) {
        continue;
      }
      const defaults = group.options.filter((option) => option.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].value).toBe(DEFAULT_PREFERENCES[group.key]);
    }
  });

  it("offers every blanket disposition", () => {
    expect(plan.blanketOptions.map((option) => option.choice)).toEqual(
      Object.values(OnboardingBlanketChoice),
    );
  });
});

describe("resolveBlanketPreferences", () => {
  it("accepting defaults writes the recommended defaults", () => {
    expect(resolveBlanketPreferences(OnboardingBlanketChoice.AcceptDefaults)).toEqual(
      DEFAULT_PREFERENCES,
    );
  });

  it("asking about everything never disables a feature outright", () => {
    const prefs = resolveBlanketPreferences(OnboardingBlanketChoice.AskEverything);
    expect(Object.values(prefs)).not.toContain(PreferenceValue.Never);
  });

  it("falls back to the default where ask is not an allowed value", () => {
    const prefs = resolveBlanketPreferences(OnboardingBlanketChoice.AskEverything);
    expect(prefs[PreferenceKey.WatcherLifetime]).toBe(
      DEFAULT_PREFERENCES[PreferenceKey.WatcherLifetime],
    );
    expect(prefs[PreferenceKey.AutoLogin]).toBe(PreferenceValue.Ask);
  });
});

describe("resolveTogglePreferences", () => {
  it("sets selected keys to always and the rest to ask", () => {
    const prefs = resolveTogglePreferences([PreferenceKey.AutoLogin]);

    expect(prefs[PreferenceKey.AutoLogin]).toBe(PreferenceValue.Always);
    expect(prefs[PreferenceKey.AutoCleanup]).toBe(PreferenceValue.Ask);
    expect(Object.keys(prefs).sort()).toEqual([...getOnboardingToggleKeys()].sort());
  });
});

describe("resolveOnboardingAnswers", () => {
  it("rejects a value the key does not allow", () => {
    expect(() =>
      resolveOnboardingAnswers({
        blanket: OnboardingBlanketChoice.Customize,
        choices: { [PreferenceKey.WatcherLifetime]: PreferenceValue.Always },
      }),
    ).toThrow(/Invalid onboarding choice/);
  });

  it("layers choices over toggle selections", () => {
    const prefs = resolveOnboardingAnswers({
      blanket: OnboardingBlanketChoice.Customize,
      selectedToggleKeys: [PreferenceKey.AutoRebase],
      choices: { [PreferenceKey.DefaultExecutionMode]: PreferenceValue.Remote },
    });

    expect(prefs[PreferenceKey.AutoRebase]).toBe(PreferenceValue.Always);
    expect(prefs[PreferenceKey.DefaultExecutionMode]).toBe(PreferenceValue.Remote);
  });

  it("writes nothing for a skip", () => {
    expect(resolveOnboardingAnswers({ blanket: OnboardingBlanketChoice.Skip })).toEqual({});
  });
});

describe("completeOnboarding", () => {
  it("writes preferences and the stamp in one pass", () => {
    completeOnboarding({ [PreferenceKey.AutoLogin]: PreferenceValue.Never }, dataDir);

    const file = readFile();
    expect((file.preferences as Record<string, string>).autoLogin).toBe(PreferenceValue.Never);
    expect(typeof file.onboardingCompletedAt).toBe("string");
    expect(needsOnboarding(dataDir)).toBe(false);
  });

  it("preserves sibling blocks written by other tools", () => {
    seedFile({
      version: 1,
      preferences: {},
      llmEnv: { MUGGLE_LLM_MODEL: "gpt-4o" },
      disclosureShownAt: "2026-01-01T00:00:00.000Z",
      telemetryEnabled: false,
    });

    completeOnboarding({ [PreferenceKey.AutoLogin]: PreferenceValue.Always }, dataDir);

    const file = readFile();
    expect(file.llmEnv).toEqual({ MUGGLE_LLM_MODEL: "gpt-4o" });
    expect(file.disclosureShownAt).toBe("2026-01-01T00:00:00.000Z");
    expect(file.telemetryEnabled).toBe(false);
  });
});

describe("recordOnboardingSkip", () => {
  it("counts declined offers without writing preference values", () => {
    const result = recordOnboardingSkip(dataDir);

    expect(result).toEqual({ offerCount: 1, isRetired: false });
    expect(readFile().preferences).toEqual({});
    expect(needsOnboarding(dataDir)).toBe(true);
  });

  it("retires the walkthrough once the cap is reached", () => {
    let result = recordOnboardingSkip(dataDir);
    for (let offer = 1; offer < ONBOARDING_MAX_OFFERS; offer += 1) {
      result = recordOnboardingSkip(dataDir);
    }

    expect(result.offerCount).toBe(ONBOARDING_MAX_OFFERS);
    expect(result.isRetired).toBe(true);
    expect(needsOnboarding(dataDir)).toBe(false);
  });
});

describe("applyOnboardingAnswers", () => {
  it("persists a completed walkthrough", () => {
    const result = applyOnboardingAnswers(
      { blanket: OnboardingBlanketChoice.AcceptDefaults },
      dataDir,
    );

    expect(result.isCompleted).toBe(true);
    expect(result.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(needsOnboarding(dataDir)).toBe(false);
  });

  it("reports a skip as incomplete until it retires", () => {
    const result = applyOnboardingAnswers({ blanket: OnboardingBlanketChoice.Skip }, dataDir);

    expect(result.isCompleted).toBe(false);
    expect(result.skip?.offerCount).toBe(1);
  });
});

describe("markOnboardingCompleted", () => {
  it("stamps without touching preferences", () => {
    seedFile({ version: 1, preferences: { autoLogin: PreferenceValue.Never } });

    markOnboardingCompleted(dataDir);

    const file = readFile();
    expect((file.preferences as Record<string, string>).autoLogin).toBe(PreferenceValue.Never);
    expect(needsOnboarding(dataDir)).toBe(false);
  });
});
