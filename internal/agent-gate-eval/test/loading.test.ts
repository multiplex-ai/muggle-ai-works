import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadAgentDefinition } from "../src/agent-definition.js";
import { parseEvalCliArgs } from "../src/cli-args.js";
import {
  listScenarioStems,
  loadAgentScenarioFile,
  loadScenarioSuites,
  scenariosForCadence,
} from "../src/scenario.js";
import { EvalTargetKind, ScenarioCadence, type AgentScenario } from "../src/types.js";

const repoScenariosDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "scenarios");

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
    expect(d.kind).toBe(EvalTargetKind.Agent);
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
  const agentTarget = { kind: EvalTargetKind.Agent, name: "a" };
  const minimalScenario = { name: "s1", prompt: "do it", expect: { outputContains: ["READY"] } };

  it("loads a valid file", () => {
    const p = writeScenarios("a", { target: agentTarget, scenarios: [minimalScenario] });
    expect(loadAgentScenarioFile(p).scenarios).toHaveLength(1);
  });

  it("accepts a second suite on one target named <target>.<suite>.json", () => {
    const p = writeScenarios("muggle-do.handoff", {
      target: { kind: EvalTargetKind.Skill, name: "muggle-do" },
      passThreshold: 1,
      scenarios: [minimalScenario],
    });
    expect(loadAgentScenarioFile(p).passThreshold).toBe(1);
  });

  it("rejects an empty scenario list", () => {
    const p = writeScenarios("a", { target: agentTarget, scenarios: [] });
    expect(() => loadAgentScenarioFile(p)).toThrow(/Invalid/);
  });

  it("rejects a file without a target, including the pre-target `agent` field", () => {
    const p = writeScenarios("a", { agent: "a", scenarios: [minimalScenario] });
    expect(() => loadAgentScenarioFile(p)).toThrow(/needs target/);
  });

  it("rejects a file whose stem does not name its target", () => {
    const p = writeScenarios("other", { target: agentTarget, scenarios: [minimalScenario] });
    expect(() => loadAgentScenarioFile(p)).toThrow(/must be named a\.json/);
  });

  it("rejects a pass threshold outside (0, 1]", () => {
    const p = writeScenarios("a", { target: agentTarget, passThreshold: 1.5, scenarios: [minimalScenario] });
    expect(() => loadAgentScenarioFile(p)).toThrow(/passThreshold/);
  });

  it("rejects a scenario missing prompt or expect", () => {
    const p = writeScenarios("a", { target: agentTarget, scenarios: [{ name: "s1", prompt: "p" }] });
    expect(() => loadAgentScenarioFile(p)).toThrow(/needs name, prompt, and expect/);
  });

  it("rejects repeated scenario names, which would merge their pass rates", () => {
    const p = writeScenarios("a", { target: agentTarget, scenarios: [minimalScenario, minimalScenario] });
    expect(() => loadAgentScenarioFile(p)).toThrow(/repeats/);
  });

  it.each([
    ["a bash response with neither response nor sequence", { bashResponses: [{ commandContains: "gh" }] }, /bashResponses/],
    ["an empty bash sequence", { bashResponses: [{ commandContains: "gh", sequence: [] }] }, /bashResponses/],
    ["a toolResponses key that is no scripted tool", { toolResponses: { Bash: [{ argContains: "", response: "x" }] } }, /toolResponses key "Bash"/],
    ["a toolResponses entry without argContains", { toolResponses: { Skill: [{ response: "x" }] } }, /toolResponses\.Skill/],
    ["an unknown cadence", { cadence: "weekly" }, /cadence/],
    ["a non-positive maxTurns", { maxTurns: 0 }, /maxTurns/],
    ["a seed file without content", { seed: { files: [{ path: "~/x" }] } }, /seed\.files/],
    ["a fixture sequence that is empty", { fixtures: { executeResult: { sequence: [] } } }, /fixtures\.executeResult/],
    ["a fixture sequence with sibling keys", { fixtures: { executeResult: { sequence: [{}], status: "x" } } }, /fixtures\.executeResult/],
    ["a transcript without a resume prompt", { seed: { transcript: { turns: [] } } }, /resumePrompt/],
    ["a transcript turn with neither text nor a tool call", { seed: { transcript: { turns: [{}], resumePrompt: "go" } } }, /needs text or a tool call/],
    ["a transcript tool call without an input object", { seed: { transcript: { turns: [{ toolCalls: [{ tool: "Read" }] }], resumePrompt: "go" } } }, /input object/],
    ["a malformed tool-attempt pattern", { expect: { requireToolSequence: [{ tool: "Bash" }] } }, /requireToolSequence\[0\]/],
    ["an anyOf with no alternatives", { expect: { forbidToolAttempts: [{ anyOf: [] }] } }, /forbidToolAttempts\[0\]/],
    ["a reference to an undefined pattern", { expect: { requireToolAttempts: [{ pattern: "watcher-armed" }] } }, /names pattern "watcher-armed"/],
  ])("rejects %s", (_label, extra, message) => {
    const p = writeScenarios("a", { target: agentTarget, scenarios: [{ ...minimalScenario, ...extra }] });
    expect(() => loadAgentScenarioFile(p)).toThrow(message);
  });

  it("rejects a malformed named pattern", () => {
    const p = writeScenarios("a", { target: agentTarget, patterns: { armed: { anyOf: [{ tool: "Skill" }] } }, scenarios: [minimalScenario] });
    expect(() => loadAgentScenarioFile(p)).toThrow(/patterns\.armed/);
  });

  it("replaces each pattern reference with the file's named pattern", () => {
    const watcherArmed = { anyOf: [{ tool: "Skill", argContains: "muggle-pr-followup" }, { tool: "Monitor", argContains: "pr-watch-arm.sh" }] };
    const p = writeScenarios("a", {
      target: agentTarget,
      patterns: { "watcher-armed": watcherArmed },
      scenarios: [
        {
          ...minimalScenario,
          expect: {
            requireToolSequence: [{ tool: "Bash", argContains: "gh pr create" }, { pattern: "watcher-armed" }],
            forbidToolAttempts: [{ pattern: "watcher-armed" }],
          },
        },
      ],
    });
    const [scenario] = loadAgentScenarioFile(p).scenarios;
    expect(scenario.expect.requireToolSequence).toEqual([{ tool: "Bash", argContains: "gh pr create" }, watcherArmed]);
    expect(scenario.expect.forbidToolAttempts).toEqual([watcherArmed]);
  });

  it("applies the file's defaults: own prompt and seed win, maps merge, own scripted replies go first", () => {
    const p = writeScenarios("a", {
      target: agentTarget,
      defaults: {
        prompt: "build it",
        maxTurns: 70,
        seed: { repo: "tiny-web-app" },
        preferences: { autoCreatePR: "always", autoUseWorktree: "never" },
        fixtures: { executeResult: { status: "passed" }, runResult: { status: "passed" } },
        bashResponses: [{ commandContains: "gh pr create", response: "https://github.com/o/r/pull/1" }],
        toolResponses: { Skill: [{ argContains: "muggle-test-prepare", response: "READY" }] },
      },
      scenarios: [
        { name: "inherits", expect: {} },
        {
          name: "overrides",
          prompt: "build it quietly",
          seed: { files: [{ path: "a.txt", content: "a" }] },
          preferences: { autoCreatePR: "never" },
          fixtures: { executeResult: { status: "failed" } },
          bashResponses: [{ commandContains: "gh pr create", response: "error" }],
          toolResponses: { Skill: [{ argContains: "muggle-test-prepare", response: "DEGRADED" }], Monitor: [{ argContains: "", response: "started" }] },
          expect: {},
        },
      ],
    });
    const [inherits, overrides] = loadAgentScenarioFile(p).scenarios;
    expect(inherits).toMatchObject({ prompt: "build it", maxTurns: 70, seed: { repo: "tiny-web-app" } });
    expect(overrides.prompt).toBe("build it quietly");
    expect(overrides.seed).toEqual({ files: [{ path: "a.txt", content: "a" }] });
    expect(overrides.maxTurns).toBe(70);
    expect(overrides.preferences).toEqual({ autoCreatePR: "never", autoUseWorktree: "never" });
    expect(overrides.fixtures).toEqual({ executeResult: { status: "failed" }, runResult: { status: "passed" } });
    expect(overrides.bashResponses?.map((entry) => entry.response)).toEqual(["error", "https://github.com/o/r/pull/1"]);
    expect(overrides.toolResponses?.Skill?.map((entry) => entry.response)).toEqual(["DEGRADED", "READY"]);
    expect(overrides.toolResponses?.Monitor?.map((entry) => entry.response)).toEqual(["started"]);
  });

  it("still requires a prompt once defaults apply", () => {
    const p = writeScenarios("a", { target: agentTarget, defaults: { maxTurns: 5 }, scenarios: [{ name: "s1", expect: {} }] });
    expect(() => loadAgentScenarioFile(p)).toThrow(/needs name, prompt, and expect/);
  });
});

describe("scenario suites", () => {
  const writeSuite = (stem: string, targetName: string): void => {
    fs.writeFileSync(
      path.join(tmpDir, `${stem}.json`),
      JSON.stringify({
        target: { kind: EvalTargetKind.Skill, name: targetName },
        scenarios: [{ name: "s", prompt: "p", expect: {} }],
      }),
    );
  };

  it("runs every scenario file by default, skipping results files", () => {
    writeSuite("muggle-do.handoff", "muggle-do");
    writeSuite("muggle-do.adherence", "muggle-do");
    fs.writeFileSync(path.join(tmpDir, "muggle-do.handoff.results.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "muggle-do.handoff.codex.results.json"), "{}");
    expect(listScenarioStems(tmpDir)).toEqual(["muggle-do.adherence", "muggle-do.handoff"]);
    expect(loadScenarioSuites(tmpDir).map((suite) => suite.stem)).toEqual(["muggle-do.adherence", "muggle-do.handoff"]);
  });

  it("runs only the suite --suite names, and refuses one with no file", () => {
    writeSuite("muggle-do.handoff", "muggle-do");
    writeSuite("muggle-do.adherence", "muggle-do");
    expect(loadScenarioSuites(tmpDir, "muggle-do.handoff").map((suite) => suite.stem)).toEqual(["muggle-do.handoff"]);
    expect(() => loadScenarioSuites(tmpDir, "missing")).toThrow(/No scenario file/);
  });

  it("loads every scenario file the repo ships, agent and skill suites alike", () => {
    const suites = loadScenarioSuites(repoScenariosDir);
    expect(suites.map((suite) => suite.file.target.kind)).toContain(EvalTargetKind.Agent);
    expect(suites.map((suite) => suite.file.target.kind)).toContain(EvalTargetKind.Skill);
  });
});

describe("scenariosForCadence", () => {
  const scenarios: AgentScenario[] = [
    { name: "default", prompt: "p", expect: {} },
    { name: "pr", prompt: "p", cadence: ScenarioCadence.Pr, expect: {} },
    { name: "nightly", prompt: "p", cadence: ScenarioCadence.Nightly, expect: {} },
  ];

  it("drops nightly-only scenarios from a PR run", () => {
    expect(scenariosForCadence(scenarios, ScenarioCadence.Pr).map((scenario) => scenario.name)).toEqual(["default", "pr"]);
  });

  it("keeps every scenario for a nightly run or when no cadence is given", () => {
    expect(scenariosForCadence(scenarios, ScenarioCadence.Nightly)).toHaveLength(3);
    expect(scenariosForCadence(scenarios, undefined)).toHaveLength(3);
  });
});

describe("parseEvalCliArgs", () => {
  it("names a suite with --suite, or with the legacy --agent that also requires an agent target", () => {
    expect(parseEvalCliArgs(["--suite", "muggle-do.handoff"])).toMatchObject({
      suite: "muggle-do.handoff",
      requireAgentTarget: false,
    });
    expect(parseEvalCliArgs(["--agent", "test-prepare-runner", "--runs", "3"])).toMatchObject({
      suite: "test-prepare-runner",
      requireAgentTarget: true,
      runs: 3,
    });
    expect(parseEvalCliArgs([]).suite).toBeUndefined();
  });

  it("collects repeated --codex-config values and reads --cadence and --model", () => {
    const args = parseEvalCliArgs([
      "--codex-config", "a=1", "--codex-config", "b=2", "--cadence", "pr", "--model", "opus", "--verbose",
    ]);
    expect(args.codexConfig).toEqual(["a=1", "b=2"]);
    expect(args.cadence).toBe(ScenarioCadence.Pr);
    expect(args.model).toBe("opus");
    expect(args.verbose).toBe(true);
  });

  it.each([
    [["--suite", "a", "--agent", "a"], /not both/],
    [["--host", "gemini"], /--host/],
    [["--cadence", "weekly"], /--cadence/],
    [["--runs", "0"], /--runs/],
    [["--concurrency", "x"], /--concurrency/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseEvalCliArgs(argv)).toThrow(message);
  });
});
