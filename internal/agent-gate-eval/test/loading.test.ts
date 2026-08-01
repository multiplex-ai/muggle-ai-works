import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadAgentDefinition } from "../src/agent-definition.js";
import { loadAgentScenarioFile } from "../src/scenario.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-gate-eval-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadAgentDefinition", () => {
  const writeAgent = (name: string, frontmatter: string, body = "# Body\ncontract text"): void => {
    fs.writeFileSync(path.join(tmpDir, `${name}.md`), `---\n${frontmatter}\n---\n${body}`);
  };

  it("parses name, resolves the model alias, and strips frontmatter from the body", () => {
    writeAgent("test-prepare-runner", "name: test-prepare-runner\ndescription: \"x\"\nmodel: opus");
    const d = loadAgentDefinition(tmpDir, "test-prepare-runner");
    expect(d.name).toBe("test-prepare-runner");
    expect(d.modelAlias).toBe("opus");
    expect(d.model).toMatch(/opus/);
    expect(d.body).not.toContain("model:");
    expect(d.body).toContain("contract text");
  });

  it("rejects an agent without a model pin", () => {
    writeAgent("no-pin", "name: no-pin\ndescription: \"x\"");
    expect(() => loadAgentDefinition(tmpDir, "no-pin")).toThrow(/model:/);
  });

  it("rejects an unknown model alias", () => {
    writeAgent("bad-alias", "name: bad-alias\nmodel: gpt-4");
    expect(() => loadAgentDefinition(tmpDir, "bad-alias")).toThrow(/unknown model alias/);
  });
});

describe("loadAgentScenarioFile", () => {
  const writeScenarios = (basename: string, content: unknown): string => {
    const p = path.join(tmpDir, `${basename}.json`);
    fs.writeFileSync(p, JSON.stringify(content));
    return p;
  };

  it("loads a valid file", () => {
    const p = writeScenarios("ok", {
      agent: "a",
      scenarios: [{ name: "s1", prompt: "do it", expect: { outputContains: ["READY"] } }],
    });
    expect(loadAgentScenarioFile(p).scenarios).toHaveLength(1);
  });

  it("rejects an empty scenario list", () => {
    const p = writeScenarios("empty", { agent: "a", scenarios: [] });
    expect(() => loadAgentScenarioFile(p)).toThrow(/Invalid/);
  });

  it("rejects a scenario missing prompt or expect", () => {
    const p = writeScenarios("partial", {
      agent: "a",
      scenarios: [{ name: "s1", prompt: "p" }],
    });
    expect(() => loadAgentScenarioFile(p)).toThrow(/needs name, prompt, and expect/);
  });
});
