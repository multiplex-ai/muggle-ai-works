import { describe, expect, it } from "vitest";

import { invocationPrompt } from "../src/harness.js";
import { EvalTargetKind, type AgentDefinition, type RunSandbox } from "../src/types.js";

const definition: AgentDefinition = {
  kind: EvalTargetKind.Agent,
  name: "runner",
  modelAlias: "haiku",
  model: "m",
  body: "body",
  filePath: "/plugin/agents/runner.md",
};
const sandbox: RunSandbox = { root: "/tmp/run", home: "/tmp/run/home", repo: "/tmp/run/repo" };

describe("invocationPrompt", () => {
  it("names the run's sandbox where the prompt says {{repo}} and {{home}}, so a plan can point at a directory that exists", () => {
    const scenario = { name: "s", prompt: "dir: {{repo}}/web, notes: {{home}}/notes.md", expect: {} };
    expect(invocationPrompt(definition, scenario, sandbox)).toBe("dir: /tmp/run/repo/web, notes: /tmp/run/home/notes.md");
  });
});
