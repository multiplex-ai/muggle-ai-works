import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { offerCiWorkflow } from "../../../cli/init/ci-question";
import { CiOfferOutcome } from "../../../cli/init/ci-question-types";
import { USER_WORKFLOW_PATH } from "../../../ci-workflow/constants";

describe("offerCiWorkflow", () => {
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

  it("asks, and installs on yes", async () => {
    const outcome = await offerCiWorkflow(answering("y"), repo);
    expect(outcome).toBe(CiOfferOutcome.Installed);
    expect(asked[0]).toMatch(/CI/i);
    expect(existsSync(join(repo, USER_WORKFLOW_PATH))).toBe(true);
  });

  it("writes nothing on no", async () => {
    expect(await offerCiWorkflow(answering("n"), repo)).toBe(CiOfferOutcome.Declined);
    expect(existsSync(join(repo, USER_WORKFLOW_PATH))).toBe(false);
  });

  // Silence is not consent to write a file into someone's repository.
  it("treats a bare Enter as no", async () => {
    expect(await offerCiWorkflow(answering(""), repo)).toBe(CiOfferOutcome.Declined);
    expect(existsSync(join(repo, USER_WORKFLOW_PATH))).toBe(false);
  });

  it("does not ask outside a git repository", async () => {
    const loose = mkdtempSync(join(tmpdir(), "muggle-init-loose-"));
    expect(await offerCiWorkflow(answering("y"), loose)).toBe(CiOfferOutcome.NotApplicable);
    expect(asked).toEqual([]);
  });

  it("does not ask when the workflow is already there", async () => {
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
    writeFileSync(join(repo, USER_WORKFLOW_PATH), "name: muggle-walkthrough\n");
    expect(await offerCiWorkflow(answering("y"), repo)).toBe(CiOfferOutcome.AlreadyInstalled);
    expect(asked).toEqual([]);
  });
});
