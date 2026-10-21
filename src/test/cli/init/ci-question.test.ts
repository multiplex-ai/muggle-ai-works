import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PreferenceValue } from "../../../../packages/mcps/src/shared/preferences-types";
import { applyCiWorkflowPreference } from "../../../cli/init/ci-question";
import { CiOfferOutcome } from "../../../cli/init/ci-question-types";
import { USER_WORKFLOW_PATH } from "../../../ci-workflow/constants";

describe("applyCiWorkflowPreference", () => {
  let repo: string;
  let asked: string[];

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "muggle-init-ci-"));
    mkdirSync(join(repo, ".git"));
    asked = [];
  });

  const answering = (reply: string) => async (question: string): Promise<string> => {
    asked.push(question);
    return reply;
  };

  const isInstalled = (): boolean => existsSync(join(repo, USER_WORKFLOW_PATH));

  it("installs without asking when set to always", async () => {
    expect(await applyCiWorkflowPreference(PreferenceValue.Always, repo, answering("n"))).toBe(CiOfferOutcome.Installed);
    expect(asked).toEqual([]);
    expect(isInstalled()).toBe(true);
  });

  it("installs on the agent surface too, where nobody can be asked", async () => {
    expect(await applyCiWorkflowPreference(PreferenceValue.Always, repo, null)).toBe(CiOfferOutcome.Installed);
    expect(isInstalled()).toBe(true);
  });

  it("stays silent and writes nothing when set to never", async () => {
    expect(await applyCiWorkflowPreference(PreferenceValue.Never, repo, answering("y"))).toBe(CiOfferOutcome.TurnedOff);
    expect(asked).toEqual([]);
    expect(isInstalled()).toBe(false);
  });

  it("asks when set to ask, and installs on yes", async () => {
    expect(await applyCiWorkflowPreference(PreferenceValue.Ask, repo, answering("y"))).toBe(CiOfferOutcome.Installed);
    expect(asked[0]).toMatch(/CI/i);
    expect(isInstalled()).toBe(true);
  });

  it("writes nothing on no", async () => {
    expect(await applyCiWorkflowPreference(PreferenceValue.Ask, repo, answering("n"))).toBe(CiOfferOutcome.Declined);
    expect(isInstalled()).toBe(false);
  });

  // Silence is not consent to write a file into someone's repository.
  it("treats a bare Enter as no", async () => {
    expect(await applyCiWorkflowPreference(PreferenceValue.Ask, repo, answering(""))).toBe(CiOfferOutcome.Declined);
    expect(isInstalled()).toBe(false);
  });

  it("defers when set to ask with nobody to answer", async () => {
    expect(await applyCiWorkflowPreference(PreferenceValue.Ask, repo, null)).toBe(CiOfferOutcome.Deferred);
    expect(isInstalled()).toBe(false);
  });

  it("does nothing outside a git repository", async () => {
    const loose = mkdtempSync(join(tmpdir(), "muggle-init-loose-"));
    expect(await applyCiWorkflowPreference(PreferenceValue.Always, loose, answering("y"))).toBe(CiOfferOutcome.NotApplicable);
    expect(asked).toEqual([]);
    expect(existsSync(join(loose, USER_WORKFLOW_PATH))).toBe(false);
  });

  it("leaves an existing workflow alone", async () => {
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
    writeFileSync(join(repo, USER_WORKFLOW_PATH), "name: mine\n");
    expect(await applyCiWorkflowPreference(PreferenceValue.Always, repo, answering("y"))).toBe(CiOfferOutcome.AlreadyInstalled);
    expect(asked).toEqual([]);
  });
});
