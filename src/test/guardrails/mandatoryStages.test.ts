import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  applySkillInvocation,
  applyStageRead,
  applyStageSkip,
  isStageSkipMarker,
  normalizeStagePath,
  parseDeclaredStages,
  resolveSkillNameFromToolInput,
  resolveSkillStagePaths,
  stageGateDecision,
  stageLabel,
  unreadMandatoryStages,
} from "../../guardrails/mandatoryStages.js";
import { MAX_STAGE_BLOCKS } from "../../guardrails/constants.js";
import { StageGateAction, type GuardrailState } from "../../guardrails/types.js";

const baseState = (): GuardrailState => ({ sessionId: "s", prsHandled: [] });

function skillsFixture(frontmatter: string): { skillsRoot: string; skillName: string } {
  const skillsRoot = mkdtempSync(join(tmpdir(), "gr-skills-"));
  mkdirSync(join(skillsRoot, "demo-skill"), { recursive: true });
  mkdirSync(join(skillsRoot, "_shared"), { recursive: true });
  writeFileSync(join(skillsRoot, "_shared", "debug-failed-run.md"), "# debug");
  writeFileSync(join(skillsRoot, "_shared", "failure-mode-handling.md"), "# failure modes");
  writeFileSync(join(skillsRoot, "demo-skill", "SKILL.md"), frontmatter);
  return { skillsRoot: skillsRoot, skillName: "demo-skill" };
}

describe("parseDeclaredStages", () => {
  it("reads a YAML list from the SKILL.md frontmatter", () => {
    const markdown = [
      "---",
      "name: demo-skill",
      "description: does a thing",
      "mandatoryStages:",
      "  - ../_shared/failure-mode-handling.md",
      "  - ../_shared/debug-failed-run.md",
      "---",
      "",
      "# Body",
      "mandatoryStages:",
      "  - not-frontmatter.md",
    ].join("\n");
    expect(parseDeclaredStages(markdown)).toEqual([
      "../_shared/failure-mode-handling.md",
      "../_shared/debug-failed-run.md",
    ]);
  });

  it("accepts quoted entries and an inline flow list", () => {
    expect(parseDeclaredStages(['---', 'mandatoryStages: ["a.md", \'b.md\']', "---"].join("\n"))).toEqual([
      "a.md",
      "b.md",
    ]);
  });

  it("returns nothing when the key is absent", () => {
    expect(parseDeclaredStages("---\nname: x\n---\nbody")).toEqual([]);
  });

  it("returns nothing when there is no frontmatter at all", () => {
    expect(parseDeclaredStages("mandatoryStages:\n  - a.md\n")).toEqual([]);
  });
});

describe("resolveSkillStagePaths", () => {
  it("resolves declared stages to normalized absolute paths", () => {
    const { skillsRoot, skillName } = skillsFixture(
      ["---", "name: demo-skill", "mandatoryStages:", "  - ../_shared/debug-failed-run.md", "---"].join("\n"),
    );
    expect(resolveSkillStagePaths(skillName, skillsRoot)).toEqual([
      normalizeStagePath(join(skillsRoot, "_shared", "debug-failed-run.md")),
    ]);
  });

  it("resolves a skill-dir-relative declaration that omits the leading ..", () => {
    const { skillsRoot, skillName } = skillsFixture(
      ["---", "name: demo-skill", "mandatoryStages:", "  - _shared/debug-failed-run.md", "---"].join("\n"),
    );
    expect(resolveSkillStagePaths(skillName, skillsRoot)).toEqual([
      normalizeStagePath(join(skillsRoot, "_shared", "debug-failed-run.md")),
    ]);
  });

  it("drops a declared stage that does not exist on disk", () => {
    const { skillsRoot, skillName } = skillsFixture(
      ["---", "name: demo-skill", "mandatoryStages:", "  - ../_shared/ghost.md", "---"].join("\n"),
    );
    expect(resolveSkillStagePaths(skillName, skillsRoot)).toEqual([]);
  });

  it("returns nothing for a skill this plugin does not own", () => {
    const { skillsRoot } = skillsFixture("---\nname: demo-skill\n---");
    expect(resolveSkillStagePaths("some-other-plugins-skill", skillsRoot)).toEqual([]);
  });

  it("refuses a declaration that escapes the skills tree", () => {
    const { skillsRoot, skillName } = skillsFixture(
      ["---", "name: demo-skill", "mandatoryStages:", "  - ../../../../etc/passwd", "---"].join("\n"),
    );
    expect(resolveSkillStagePaths(skillName, skillsRoot)).toEqual([]);
  });
});

describe("resolveSkillNameFromToolInput", () => {
  it.each([
    ["skill", { skill: "muggle-test" }],
    ["skillName", { skillName: "muggle-test" }],
    ["name", { name: "muggle-test" }],
    ["command", { command: "muggle-test" }],
  ])("reads the invoked skill from the %s input key", (_label, toolInput) => {
    expect(resolveSkillNameFromToolInput(toolInput)).toBe("muggle-test");
  });

  it("strips the plugin namespace a plugin skill is invoked under", () => {
    expect(resolveSkillNameFromToolInput({ skill: "muggle:muggle-test" })).toBe("muggle-test");
  });

  it("strips a leading slash from a slash-command invocation", () => {
    expect(resolveSkillNameFromToolInput({ skill: "/muggle-test" })).toBe("muggle-test");
  });

  it("rejects a name that is not a single path segment", () => {
    expect(resolveSkillNameFromToolInput({ skill: "../../etc/passwd" })).toBeUndefined();
  });

  it("returns nothing when no key carries a skill name", () => {
    expect(resolveSkillNameFromToolInput({ args: "--flag" })).toBeUndefined();
  });
});

describe("stage bookkeeping", () => {
  it("records the invoked skill and its stages, deduping across invocations", () => {
    const invoked = applySkillInvocation(baseState(), "muggle-test", ["/p/skills/_shared/a.md"]);
    expect(invoked.lastInvokedSkillName).toBe("muggle-test");
    expect(invoked.mandatoryStages).toEqual(["/p/skills/_shared/a.md"]);
    const twice = applySkillInvocation(invoked, "muggle-test", ["/p/skills/_shared/a.md"]);
    expect(twice.mandatoryStages).toEqual(["/p/skills/_shared/a.md"]);
  });

  it("keeps stages owed by an earlier skill when a second skill is invoked", () => {
    const first = applySkillInvocation(baseState(), "muggle-test", ["/p/skills/_shared/a.md"]);
    const second = applySkillInvocation(first, "muggle-do", ["/p/skills/_shared/b.md"]);
    expect(second.mandatoryStages).toEqual(["/p/skills/_shared/a.md", "/p/skills/_shared/b.md"]);
    expect(second.lastInvokedSkillName).toBe("muggle-do");
  });

  it("records a read under the same normalization the stages use", () => {
    const read = applyStageRead(baseState(), "C:\\Plugin\\Skills\\_Shared\\A.md");
    expect(read.stagesRead).toEqual(["c:/plugin/skills/_shared/a.md"]);
  });

  it("counts a stage as read once its normalized path was read", () => {
    const invoked = applySkillInvocation(baseState(), "muggle-test", [
      "/p/skills/_shared/a.md",
      "/p/skills/_shared/b.md",
    ]);
    const afterRead = applyStageRead(invoked, "/p/skills/_shared/a.md");
    expect(unreadMandatoryStages(afterRead)).toEqual(["/p/skills/_shared/b.md"]);
  });

  it("keeps a read recorded before the skill was invoked", () => {
    const read = applyStageRead(baseState(), "/p/skills/_shared/a.md");
    const invoked = applySkillInvocation(read, "muggle-test", ["/p/skills/_shared/a.md"]);
    expect(unreadMandatoryStages(invoked)).toEqual([]);
  });

  it("labels a stage by its path inside the skills tree", () => {
    expect(stageLabel("c:/users/x/plugin/skills/_shared/debug-failed-run.md")).toBe(
      "_shared/debug-failed-run.md",
    );
  });
});

describe("stage skip marker", () => {
  it("accepts the documented echo form", () => {
    expect(isStageSkipMarker('echo "MUGGLE_STAGE_SKIP: no failures to debug"')).toBe(true);
  });

  it("ignores a mention that is not the declaration", () => {
    expect(isStageSkipMarker("grep -rn MUGGLE_STAGE_SKIP plugin/")).toBe(false);
  });

  it("records the skip once", () => {
    const skipped = applyStageSkip(baseState(), true);
    expect(skipped.stageSkipped).toBe(true);
    expect(applyStageSkip(skipped, true)).toBe(skipped);
  });
});

describe("stageGateDecision", () => {
  it("does nothing when every declared stage was read", () => {
    expect(stageGateDecision(baseState(), []).action).toBe(StageGateAction.None);
  });

  it("blocks while a declared stage is unread", () => {
    const decision = stageGateDecision(baseState(), ["/p/skills/_shared/a.md"]);
    expect(decision.action).toBe(StageGateAction.Block);
    expect(decision.blockCount).toBe(1);
    expect(decision.unread).toEqual(["/p/skills/_shared/a.md"]);
  });

  it("stays quiet once a skip was recorded", () => {
    const state = applyStageSkip(baseState(), true);
    expect(stageGateDecision(state, ["/p/skills/_shared/a.md"]).action).toBe(StageGateAction.None);
  });

  it("releases after the reminder ceiling so an unreadable stage cannot trap the session", () => {
    const state = { ...baseState(), stageBlockCount: MAX_STAGE_BLOCKS };
    expect(stageGateDecision(state, ["/p/skills/_shared/a.md"]).action).toBe(StageGateAction.Release);
  });
});
