import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MODEL_ALIASES } from "../../skill-gate-eval/src/constants.js";
import { DEFAULT_SKILL_MODEL } from "../src/constants.js";
import { buildPreferencesContext } from "../src/session-context.js";
import { buildSkillInvocationMessage, loadSkillDefinition } from "../src/skill-definition.js";
import { loadTargetDefinition, pluginRootOf } from "../src/target-definition.js";
import { EvalTargetKind } from "../src/types.js";

const repoRoot = process.cwd();
const repoSkillsDir = path.join(repoRoot, "plugin", "skills");

let pluginRoot: string;
let skillsDir: string;

function writeSkill(name: string, frontmatter: string, body: string): void {
  fs.mkdirSync(path.join(skillsDir, name), { recursive: true });
  fs.writeFileSync(path.join(skillsDir, name, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`);
}

beforeEach(() => {
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-gate-eval-plugin-"));
  skillsDir = path.join(pluginRoot, "skills");
  fs.mkdirSync(path.join(pluginRoot, "config"), { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, "config", "preference-defaults.json"),
    JSON.stringify({ autoCreatePR: "always", autoResolveConflicts: "always", maxCatchUpRebases: "20" }),
  );
});

afterEach(() => {
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

describe("loadSkillDefinition", () => {
  it("strips the frontmatter and records the skill's own directory", () => {
    writeSkill("demo", "name: demo\ndescription: x", "# Demo\nbody");
    const definition = loadSkillDefinition(skillsDir, "demo");
    expect(definition.kind).toBe(EvalTargetKind.Skill);
    expect(definition.name).toBe("demo");
    expect(definition.body).toBe("# Demo\nbody");
    expect(definition.baseDir).toBe(path.join(skillsDir, "demo"));
    expect(definition.filePath).toBe(path.join(skillsDir, "demo", "SKILL.md"));
  });

  it("runs on --model first, then the frontmatter pin, then DEFAULT_SKILL_MODEL", () => {
    writeSkill("pinned", "name: pinned\nmodel: haiku", "b");
    writeSkill("unpinned", "name: unpinned", "b");
    expect(loadSkillDefinition(skillsDir, "pinned").model).toBe(MODEL_ALIASES.haiku);
    expect(loadSkillDefinition(skillsDir, "pinned", "claude-opus-5-5").model).toBe("claude-opus-5-5");
    expect(loadSkillDefinition(skillsDir, "pinned", "sonnet").model).toBe(MODEL_ALIASES.sonnet);
    expect(loadSkillDefinition(skillsDir, "unpinned").model).toBe(DEFAULT_SKILL_MODEL);
    expect(loadSkillDefinition(skillsDir, "unpinned").modelAlias).toBeUndefined();
  });

  it("rejects a pin to an unknown alias", () => {
    writeSkill("bad", "name: bad\nmodel: gpt-4", "b");
    expect(() => loadSkillDefinition(skillsDir, "bad")).toThrow(/unknown model alias/);
  });
});

describe("buildSkillInvocationMessage", () => {
  it("names the command and its arguments, then the base-directory line and body, with the arguments appended", () => {
    writeSkill("demo", "name: demo", "# Demo\nSee [stage](../do/stage.md).\n");
    const message = buildSkillInvocationMessage(loadSkillDefinition(skillsDir, "demo"), "rebase on https://x/pull/1 slug=s");
    expect(message).toBe(
      [
        "<command-name>/demo</command-name>\n<command-args>rebase on https://x/pull/1 slug=s</command-args>",
        `Base directory for this skill: ${path.join(skillsDir, "demo")}`,
        "# Demo\nSee [stage](../do/stage.md).",
        "ARGUMENTS: rebase on https://x/pull/1 slug=s",
      ].join("\n\n"),
    );
  });

  it("substitutes every $ARGUMENTS in the body instead of appending", () => {
    writeSkill("demo", "name: demo", "Resolve `$ARGUMENTS` first. Then $ARGUMENTS again.");
    const message = buildSkillInvocationMessage(loadSkillDefinition(skillsDir, "demo"), "fix ci lint");
    expect(message).toContain("Resolve `fix ci lint` first. Then fix ci lint again.");
    expect(message).not.toContain("ARGUMENTS:");
  });

  it("appends nothing for an empty invocation", () => {
    writeSkill("demo", "name: demo", "# Demo");
    const message = buildSkillInvocationMessage(loadSkillDefinition(skillsDir, "demo"), "");
    expect(message).toContain("<command-args></command-args>");
    expect(message).not.toContain("ARGUMENTS");
  });

  it("lets muggle-do's relative stage links resolve from the base directory it names", () => {
    const definition = loadSkillDefinition(repoSkillsDir, "muggle-do");
    const message = buildSkillInvocationMessage(definition, "rebase on https://github.com/o/r/pull/1 slug=s");
    const baseDirLine = message.split("\n").find((line) => line.startsWith("Base directory for this skill: "))!;
    const baseDir = baseDirLine.replace("Base directory for this skill: ", "");
    for (const link of definition.body.matchAll(/\]\((\.\.\/[^)]+\.md)\)/g)) {
      expect(fs.existsSync(path.resolve(baseDir, link[1])), link[1]).toBe(true);
    }
  });
});

describe("buildPreferencesContext", () => {
  it("emits every shipped default with the scenario's preferences set over them, as SessionStart does", () => {
    expect(buildPreferencesContext(pluginRoot, { autoResolveConflicts: "never" })).toBe(
      "Muggle Test Preferences (~/.muggle-ai/preferences.json):\nautoCreatePR=always autoResolveConflicts=never maxCatchUpRebases=20",
    );
    expect(buildPreferencesContext(pluginRoot, undefined)).toContain("autoResolveConflicts=always");
  });

  it("rejects a preference no default declares, which would otherwise be silently inert", () => {
    expect(() => buildPreferencesContext(pluginRoot, { autoCreatePr: "never" })).toThrow(/autoCreatePr/);
  });

  it("reads the shipped defaults from the repo's plugin tree", () => {
    expect(buildPreferencesContext(path.join(repoRoot, "plugin"), { autoCreatePR: "never" })).toContain("autoCreatePR=never");
  });
});

describe("loadTargetDefinition", () => {
  it("loads a skill target from the skills directory and an agent target from the agents directory", () => {
    writeSkill("demo", "name: demo", "b");
    fs.mkdirSync(path.join(pluginRoot, "agents"));
    fs.writeFileSync(path.join(pluginRoot, "agents", "runner.md"), "---\nname: runner\nmodel: haiku\n---\nbody");
    const directories = { agentsDir: path.join(pluginRoot, "agents"), skillsDir: skillsDir };

    const skill = loadTargetDefinition({ kind: EvalTargetKind.Skill, name: "demo" }, directories, "opus");
    const agent = loadTargetDefinition({ kind: EvalTargetKind.Agent, name: "runner" }, directories, "opus");

    expect(skill.model).toBe(MODEL_ALIASES.opus);
    expect(agent.model).toBe(MODEL_ALIASES.haiku);
    expect(pluginRootOf(skill)).toBe(pluginRoot);
    expect(pluginRootOf(agent)).toBe(pluginRoot);
  });

  it("refuses an agent file whose frontmatter names another agent", () => {
    fs.mkdirSync(path.join(pluginRoot, "agents"));
    fs.writeFileSync(path.join(pluginRoot, "agents", "runner.md"), "---\nname: other\nmodel: haiku\n---\nbody");
    expect(() =>
      loadTargetDefinition(
        { kind: EvalTargetKind.Agent, name: "runner" },
        { agentsDir: path.join(pluginRoot, "agents"), skillsDir: skillsDir },
      ),
    ).toThrow(/not other/);
  });
});
