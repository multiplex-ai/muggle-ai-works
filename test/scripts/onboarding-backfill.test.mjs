import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { backfillOnboardingStamp } from "../../scripts/onboarding-backfill.mjs";

let dataDir;

const read = () => JSON.parse(readFileSync(join(dataDir, "preferences.json"), "utf-8"));
const seed = (contents) => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "preferences.json"), JSON.stringify(contents, null, 2), "utf-8");
};

beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "muggle-backfill-"));
});

afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
});

describe("backfillOnboardingStamp", () => {
    it("leaves a new installation unstamped so the walkthrough fires", () => {
        const result = backfillOnboardingStamp(dataDir);

        expect(result.stamped).toBe(false);
        expect(result.reason).toBe("new installation");
    });

    it("stamps an existing user who was never offered the walkthrough", () => {
        seed({ version: 1, preferences: { autoLogin: "always" } });

        const result = backfillOnboardingStamp(dataDir);

        expect(result.stamped).toBe(true);
        expect(typeof read().onboardingCompletedAt).toBe("string");
    });

    it("preserves everything already in the file", () => {
        seed({
            version: 1,
            preferences: { autoLogin: "never" },
            llmEnv: { MUGGLE_LLM_MODEL: "gpt-4o" },
            disclosureShownAt: "2026-01-01T00:00:00.000Z",
        });

        backfillOnboardingStamp(dataDir);

        const file = read();
        expect(file.preferences).toEqual({ autoLogin: "never" });
        expect(file.llmEnv).toEqual({ MUGGLE_LLM_MODEL: "gpt-4o" });
        expect(file.disclosureShownAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("does not move an existing stamp", () => {
        seed({ version: 1, preferences: {}, onboardingCompletedAt: "2020-05-05T00:00:00.000Z" });

        const result = backfillOnboardingStamp(dataDir);

        expect(result.stamped).toBe(false);
        expect(read().onboardingCompletedAt).toBe("2020-05-05T00:00:00.000Z");
    });

    it("never throws on a corrupt preferences file", () => {
        mkdirSync(dataDir, { recursive: true });
        writeFileSync(join(dataDir, "preferences.json"), "{ not json", "utf-8");

        const result = backfillOnboardingStamp(dataDir);

        expect(result.stamped).toBe(false);
        expect(result.reason).toContain("unreadable");
    });
});
