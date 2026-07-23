import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const agentsDir = path.join(repoRoot, "plugin", "agents");
const skillsDir = path.join(repoRoot, "plugin", "skills");

interface AgentFrontmatter {
  name: string;
  description: string;
  model: string;
}

function parseFrontmatter(agentFilePath: string): AgentFrontmatter {
  const body = fs.readFileSync(agentFilePath, "utf8");
  const frontmatterMatch = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  expect(frontmatterMatch, `${agentFilePath} has a frontmatter block`).toBeTruthy();
  const block = frontmatterMatch![1];
  const field = (key: string): string => {
    const m = block.match(new RegExp(`^${key}:[ \\t]*"?(.+?)"?[ \\t]*$`, "m"));
    return m ? m[1].trim() : "";
  };
  return { name: field("name"), description: field("description"), model: field("model") };
}

function markdownLinkTargets(agentFilePath: string): string[] {
  const body = fs.readFileSync(agentFilePath, "utf8");
  const targets: string[] = [];
  for (const match of body.matchAll(/\]\(([^)]+\.md)\)/g)) {
    targets.push(match[1]);
  }
  return targets;
}

const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));

describe("plugin agent contracts", () => {
  it("finds the pinned execution agents", () => {
    expect(agentFiles).toContain("visual-walkthrough-builder.md");
    expect(agentFiles).toContain("test-prepare-runner.md");
  });

  it.each(agentFiles)("%s frontmatter name matches its filename", (file) => {
    const frontmatter = parseFrontmatter(path.join(agentsDir, file));
    expect(frontmatter.name).toBe(path.basename(file, ".md"));
    expect(frontmatter.description.length).toBeGreaterThan(20);
  });

  it.each(agentFiles)("%s declares a model pin from the allowed set", (file) => {
    const frontmatter = parseFrontmatter(path.join(agentsDir, file));
    // The pin is the whole point of these agents (SKILL.md model: is inert
    // mid-session) — an agent without one silently runs at the session model.
    expect(["haiku", "sonnet", "opus"]).toContain(frontmatter.model);
  });

  it.each(agentFiles)("%s markdown links resolve to existing files", (file) => {
    for (const target of markdownLinkTargets(path.join(agentsDir, file))) {
      const resolved = path.resolve(agentsDir, target);
      expect(fs.existsSync(resolved), `${file} -> ${target}`).toBe(true);
    }
  });
});

describe("test-prepare-runner contract", () => {
  const agentPath = path.join(agentsDir, "test-prepare-runner.md");
  const body = fs.readFileSync(agentPath, "utf8");

  it("pins opus (reliability floor for the readiness verdict)", () => {
    expect(parseFrontmatter(agentPath).model).toBe("opus");
  });

  it("carries the output contract other skills gate on", () => {
    expect(body).toContain("READY");
    expect(body).toContain("DEGRADED");
    expect(body).toContain("needs-input:");
  });

  it("runs the execute-phase stage files of muggle-test-prepare", () => {
    for (const stage of [
      "check-running", "env-file", "start-commands", "fresh-install",
      "start-services", "smoke-test", "readiness-report",
    ]) {
      expect(body, `references steps/${stage}.md`).toContain(`steps/${stage}.md`);
    }
  });
});

describe("visual-walkthrough-builder contract", () => {
  const agentPath = path.join(agentsDir, "visual-walkthrough-builder.md");
  const body = fs.readFileSync(agentPath, "utf8");

  it("pins sonnet", () => {
    expect(parseFrontmatter(agentPath).model).toBe("sonnet");
  });

  it("renders via the CLI and honors the three modes", () => {
    expect(body).toContain("muggle build-pr-section");
    expect(body).toContain("post");
    expect(body).toContain("render-for-new-pr");
    expect(body).toContain("embed");
    expect(body).toContain("needs-input:");
  });
});

describe("skill -> agent dispatch consistency", () => {
  const dispatchPairs = [
    { skill: "muggle-test-prepare", agent: "test-prepare-runner" },
    { skill: "muggle-pr-visual-walkthrough", agent: "visual-walkthrough-builder" },
  ];

  it.each(dispatchPairs)("$skill dispatches $agent by its exact frontmatter name", ({ skill, agent }) => {
    const skillBody = fs.readFileSync(path.join(skillsDir, skill, "SKILL.md"), "utf8");
    expect(skillBody).toContain(`muggle:${agent}`);
    expect(skillBody).toContain(`plugin/agents/${agent}.md`);
  });

  it("leaves no stale pre-rename agent references anywhere in plugin/", () => {
    const staleWalkthrough = /(?<!visual-)walkthrough-builder/;
    const stalePrepare = /(?<!test-)prepare-runner/;
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(p);
        else if (entry.name.endsWith(".md")) {
          const text = fs.readFileSync(p, "utf8");
          if (staleWalkthrough.test(text) || stalePrepare.test(text)) offenders.push(p);
        }
      }
    };
    scan(path.join(repoRoot, "plugin"));
    expect(offenders).toEqual([]);
  });

  it("model-tiers doc names both execution agents", () => {
    const tiersDoc = fs.readFileSync(path.join(skillsDir, "CLAUDE.md"), "utf8");
    expect(tiersDoc).toContain("visual-walkthrough-builder");
    expect(tiersDoc).toContain("test-prepare-runner");
  });
});
