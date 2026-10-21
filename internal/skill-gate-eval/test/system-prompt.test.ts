import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildCodexInstructions } from "../src/codex-harness.js";
import { buildSystemPrompt } from "../src/harness.js";
import type { RunOptions } from "../src/types.js";

const SKILL = "muggle-status";
const GATE = "checkForUpdates";

const SKILL_BODY = "SKILL_BODY_MARKER";
const GATE_BODY = "GATE_BODY_MARKER";
const SUPPORT_BODY = "SUPPORT_FILE_MARKER";

/**
 * The gate prompt's file inputs are a contract, not an implementation detail:
 * `.github/workflows/skill-eval.yml` skips the gate suite for support-file
 * changes *because* nothing but SKILL.md and the gate contract can reach a
 * prompt — the harness denies the Read tool, so a skill under eval cannot open
 * anything else. If that ever stops holding, this test fails and the workflow's
 * scope rule has to widen with it. The Codex harness (no shell, every other tool
 * denied) is held to the same contract; its one addition is the AskUserQuestion
 * row of the skills' host-tool-equivalents table, which its scope rule covers.
 */
const PROMPT_BUILDERS = [
  { host: "the agent SDK", build: buildSystemPrompt },
  { host: "Codex", build: buildCodexInstructions },
];

describe.each(PROMPT_BUILDERS)("the gate prompt under $host is built from the skill and its gate contract only", ({ build }) => {
  let skillsDir: string;
  let options: RunOptions;

  beforeEach(() => {
    skillsDir = mkdtempSync(join(tmpdir(), "gate-prompt-"));
    mkdirSync(join(skillsDir, SKILL, "support"), { recursive: true });
    writeFileSync(join(skillsDir, SKILL, "SKILL.md"), SKILL_BODY);
    writeFileSync(join(skillsDir, SKILL, "support", "helper.md"), SUPPORT_BODY);
    mkdirSync(join(skillsDir, "muggle-preferences", "preference-gates"), { recursive: true });
    writeFileSync(
      join(skillsDir, "muggle-preferences", "preference-gates", `${GATE}.md`),
      GATE_BODY,
    );
    mkdirSync(join(skillsDir, "_shared"), { recursive: true });
    writeFileSync(
      join(skillsDir, "_shared", "host-tool-equivalents.md"),
      "| `AskUserQuestion` | Clickable options | QUESTION_RULE_MARKER |\n",
    );

    options = {
      scenarioFile: { skill: SKILL, gate: GATE, fixturesPath: "./fixtures", scenarios: [] },
      scenarioFilePath: join(skillsDir, "scenarios.json"),
      scenario: {
        name: "ask-fires-picker",
        preferences: { checkForUpdates: "ask" },
        userPrompt: "run muggle status",
      },
      skillsDir: skillsDir,
      model: "claude-haiku-4-5-20251001",
    };
  });

  it("carries the skill body and the gate contract", () => {
    const prompt = build(options);
    expect(prompt).toContain(SKILL_BODY);
    expect(prompt).toContain(GATE_BODY);
  });

  it("never reaches a support file in the skill directory", () => {
    expect(build(options)).not.toContain(SUPPORT_BODY);
  });

  it("carries the scenario's preferences, which are the other half of the input", () => {
    expect(build(options)).toContain("checkForUpdates=ask");
  });
});
