import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SIMULATED_OUTPUT_PREFIX } from "../src/constants.js";
import { listScenarioStems, loadAgentScenarioFile } from "../src/scenario.js";
import { createRunSandbox, removeRunSandbox, sandboxPathContext } from "../src/sandbox/sandbox.js";
import { createBashResponder, createToolResponder } from "../src/tools/scripted-replies.js";
import { createMockToolAnswerer } from "../src/tools/sequenced-mock-mcp.js";
import { buildTranscriptEntries } from "../src/transcript/entries.js";
import { formatReadResult, materializeTranscript } from "../src/transcript/materialize.js";
import { resumeFromSeedTranscript } from "../src/transcript/resume.js";
import {
  ScriptedTool,
  type MaterializedTurn,
  type RunSandbox,
  type SeedTranscript,
  type TranscriptMaterializeContext,
} from "../src/types.js";

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoPluginRoot = path.resolve(packageDir, "..", "..", "plugin");

let sandbox: RunSandbox;
let pluginRoot: string;

function contextFor(overrides: Partial<TranscriptMaterializeContext> = {}): TranscriptMaterializeContext {
  return {
    paths: sandboxPathContext(sandbox, [pluginRoot]),
    pluginRoot: pluginRoot,
    answerBash: createBashResponder([{ commandContains: "git status", response: "clean" }]),
    answerTool: createToolResponder({ [ScriptedTool.TodoWrite]: [{ argContains: "", response: "Todos updated." }] }),
    answerMockTool: createMockToolAnswerer({}),
    ...overrides,
  };
}

beforeEach(() => {
  sandbox = createRunSandbox({ files: [{ path: "src/app.js", content: "export const greeting = \"hi\";\n" }] });
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-gate-eval-transcript-plugin-"));
  fs.mkdirSync(path.join(pluginRoot, "skills", "do"), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, "skills", "do", "stage.md"), "# Stage\nDo the thing.");
});

afterEach(() => {
  removeRunSandbox(sandbox);
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

describe("materializeTranscript", () => {
  it("answers a Read from the file itself, with its paths filled in", () => {
    const transcript: SeedTranscript = {
      turns: [{ toolCalls: [{ tool: "Read", input: { file_path: "{{pluginRoot}}/skills/do/stage.md" } }] }],
      resumePrompt: "continue",
    };
    const [turn] = materializeTranscript(transcript, contextFor());
    expect(turn.toolCalls[0]).toEqual({
      sessionToolName: "Read",
      input: { file_path: `${pluginRoot}/skills/do/stage.md` },
      result: "1\t# Stage\n2\tDo the thing.",
      isError: false,
    });
  });

  it("applies Write and Edit to the sandbox in order and answers with the built-in tool's confirmation", () => {
    const transcript: SeedTranscript = {
      turns: [
        { toolCalls: [{ tool: "Write", input: { file_path: "~/.muggle-ai/s/state.md", content: "# State\n- Working tree: {{repo}}\n" } }] },
        { toolCalls: [{ tool: "Edit", input: { file_path: "~/.muggle-ai/s/state.md", old_string: "# State", new_string: "# Session state" } }] },
        { toolCalls: [{ tool: "Edit", input: { file_path: "{{repo}}/src/app.js", old_string: "\"hi\"", new_string: "\"hello\"" } }] },
      ],
      resumePrompt: "continue",
    };
    const turns = materializeTranscript(transcript, contextFor());
    expect(fs.readFileSync(path.join(sandbox.home, ".muggle-ai", "s", "state.md"), "utf8")).toBe(
      `# Session state\n- Working tree: ${sandbox.repo}\n`,
    );
    expect(fs.readFileSync(path.join(sandbox.repo, "src", "app.js"), "utf8")).toBe("export const greeting = \"hello\";\n");
    expect(turns[0].toolCalls[0].result).toBe("File created successfully at: ~/.muggle-ai/s/state.md");
    expect(turns[1].toolCalls[0].result).toBe("The file ~/.muggle-ai/s/state.md has been updated successfully.");
  });

  it("matches an Edit's LF text against a CRLF file", () => {
    fs.writeFileSync(path.join(sandbox.repo, "notes.md"), "one\r\ntwo\r\n");
    const transcript: SeedTranscript = {
      turns: [{ toolCalls: [{ tool: "Edit", input: { file_path: "{{repo}}/notes.md", old_string: "one\ntwo", new_string: "one\n1.5\ntwo" } }] }],
      resumePrompt: "continue",
    };
    materializeTranscript(transcript, contextFor());
    expect(fs.readFileSync(path.join(sandbox.repo, "notes.md"), "utf8")).toBe("one\r\n1.5\r\ntwo\r\n");
  });

  it("answers Bash as the live harness does — a scripted-output denial — from the call's result or the scenario's scripts", () => {
    const transcript: SeedTranscript = {
      turns: [
        {
          toolCalls: [
            { tool: "Bash", input: { command: "git branch --show-current" }, result: "main" },
            { tool: "Bash", input: { command: "git status" } },
          ],
        },
      ],
      resumePrompt: "continue",
    };
    const [turn] = materializeTranscript(transcript, contextFor());
    expect(turn.toolCalls.map((toolCall) => [toolCall.result, toolCall.isError])).toEqual([
      [`${SIMULATED_OUTPUT_PREFIX}main`, true],
      [`${SIMULATED_OUTPUT_PREFIX}clean`, true],
    ]);
  });

  it("names host stubs and mock muggle tools as the session does and answers them from the scenario's scripts", () => {
    const transcript: SeedTranscript = {
      turns: [
        {
          toolCalls: [
            { tool: "TodoWrite", input: { todos: [] } },
            { tool: "muggle-remote-auth-status", input: {} },
            { tool: "Skill", input: { skill: "muggle-test-prepare" }, result: "READY" },
          ],
        },
      ],
      resumePrompt: "continue",
    };
    const [turn] = materializeTranscript(transcript, contextFor());
    expect(turn.toolCalls.map((toolCall) => [toolCall.sessionToolName, toolCall.result])).toEqual([
      ["mcp__eval_host__TodoWrite", "Todos updated."],
      ["mcp__eval_mock__muggle-remote-auth-status", JSON.stringify({ authenticated: true, email: "tester@example.com" })],
      ["mcp__eval_host__Skill", "READY"],
    ]);
  });

  it.each([
    ["a Write outside the sandbox", { tool: "Write", input: { file_path: "{{pluginRoot}}/skills/x.md", content: "x" } }, /limited to the sandbox/],
    ["a Read of a missing file", { tool: "Read", input: { file_path: "{{repo}}/missing.js" } }, /lack/],
    ["an Edit whose old_string is absent", { tool: "Edit", input: { file_path: "{{repo}}/src/app.js", old_string: "nope", new_string: "x" } }, /occurs 0 times/],
    ["a call nothing answers", { tool: "WebFetch", input: { url: "https://example.com" } }, /nothing in this eval answers it/],
  ])("refuses %s, naming the call", (_label, toolCall, message) => {
    const transcript: SeedTranscript = { turns: [{ text: "t", toolCalls: [toolCall] }], resumePrompt: "continue" };
    expect(() => materializeTranscript(transcript, contextFor())).toThrow(message);
    expect(() => materializeTranscript(transcript, contextFor())).toThrow(/turns\[0\]\.toolCalls\[0\]/);
  });
});

describe("formatReadResult", () => {
  it("numbers each line from 1, as the Read tool does", () => {
    expect(formatReadResult("a\r\nb")).toBe("1\ta\n2\tb");
  });
});

describe("buildTranscriptEntries", () => {
  const turns: MaterializedTurn[] = [
    {
      text: "Reading the stage file.",
      toolCalls: [
        { sessionToolName: "Read", input: { file_path: "/p/stage.md" }, result: "1\t# Stage", isError: false },
        { sessionToolName: "Bash", input: { command: "git status" }, result: "SIMULATED OUTPUT", isError: true },
      ],
    },
    { text: "Stage 5 done.", toolCalls: [] },
  ];
  const entries = buildTranscriptEntries("<command-name>/muggle-do</command-name>", turns, {
    sessionId: "11111111-1111-4111-8111-111111111111",
    cwd: "/sandbox/repo",
    model: "claude-sonnet-5-5",
    startedAt: new Date("2026-10-21T20:00:00Z"),
  });

  it("opens with the first user message, then per turn an assistant message and its tool results", () => {
    expect(entries.map((entry) => entry.type)).toEqual(["user", "assistant", "user", "assistant"]);
    expect((entries[0].message as { content: string }).content).toBe("<command-name>/muggle-do</command-name>");
  });

  it("links each entry to the one before it and stamps the session on every entry", () => {
    expect(entries[0].parentUuid).toBeNull();
    for (let index = 1; index < entries.length; index++) expect(entries[index].parentUuid).toBe(entries[index - 1].uuid);
    expect(new Set(entries.map((entry) => entry.uuid)).size).toBe(entries.length);
    for (const entry of entries) expect(entry).toMatchObject({ sessionId: "11111111-1111-4111-8111-111111111111", cwd: "/sandbox/repo", isSidechain: false });
    expect(entries.map((entry) => entry.timestamp)).toEqual([
      "2026-10-21T20:00:00.000Z",
      "2026-10-21T20:00:01.000Z",
      "2026-10-21T20:00:02.000Z",
      "2026-10-21T20:00:03.000Z",
    ]);
  });

  it("pairs each tool_use with its tool_result and marks a denial as an error", () => {
    const assistant = entries[1].message as { content: Array<{ type: string; id?: string; name?: string }>; stop_reason: string; model: string };
    expect(assistant.content.map((block) => block.type)).toEqual(["text", "tool_use", "tool_use"]);
    expect(assistant.stop_reason).toBe("tool_use");
    expect(assistant.model).toBe("claude-sonnet-5-5");
    const results = (entries[2].message as { content: Array<{ tool_use_id: string; content: string; is_error?: boolean }> }).content;
    expect(results.map((block) => block.tool_use_id)).toEqual([assistant.content[1].id, assistant.content[2].id]);
    expect(results.map((block) => block.is_error)).toEqual([undefined, true]);
    expect((entries[3].message as { stop_reason: string }).stop_reason).toBe("end_turn");
  });
});

describe("resumeFromSeedTranscript", () => {
  it("serves the built session from its store under the session id it resumes, and fills the resume prompt's paths", async () => {
    const transcript: SeedTranscript = {
      turns: [{ text: "Done with Stage 5.", toolCalls: [{ tool: "Write", input: { file_path: "~/marker.md", content: "x" } }] }],
      resumePrompt: "continue in {{repo}}",
    };
    const resume = resumeFromSeedTranscript({
      transcript: transcript,
      firstUserMessage: "invocation",
      model: "claude-sonnet-5-5",
      context: contextFor(),
    });
    const sessionId = resume.queryOptions.resume!;
    const store = resume.queryOptions.sessionStore!;
    const projectKey = "any-project";
    expect(resume.prompt).toBe(`continue in ${sandbox.repo}`);
    expect(fs.existsSync(path.join(sandbox.home, "marker.md"))).toBe(true);
    const loaded = await store.load({ projectKey: projectKey, sessionId: sessionId });
    expect(loaded?.map((entry) => entry.type)).toEqual(["user", "assistant", "user"]);
    expect(await store.load({ projectKey: projectKey, sessionId: "another-session" })).toBeNull();
    expect(await store.load({ projectKey: projectKey, sessionId: sessionId, subpath: "subagents/agent-1" })).toBeNull();
    await expect(store.append({ projectKey: projectKey, sessionId: sessionId }, [])).resolves.toBeUndefined();
  });
});

describe("shipped scenario transcripts", () => {
  const scenariosDir = path.join(packageDir, "scenarios");
  const transcriptScenarios = listScenarioStems(scenariosDir).flatMap((stem) =>
    loadAgentScenarioFile(path.join(scenariosDir, `${stem}.json`))
      .scenarios.filter((scenario) => scenario.seed?.transcript)
      .map((scenario) => [`${stem}/${scenario.name}`, scenario] as const),
  );

  it.each(transcriptScenarios)("%s materializes against the plugin tree and its fixture repo", (_label, scenario) => {
    const runSandbox = createRunSandbox(scenario.seed);
    try {
      const turns = materializeTranscript(scenario.seed!.transcript!, {
        paths: sandboxPathContext(runSandbox, [repoPluginRoot]),
        pluginRoot: repoPluginRoot,
        answerBash: createBashResponder(scenario.bashResponses),
        answerTool: createToolResponder(scenario.toolResponses),
        answerMockTool: createMockToolAnswerer(scenario.fixtures ?? {}),
      });
      expect(turns.length).toBe(scenario.seed!.transcript!.turns.length);
    } finally {
      removeRunSandbox(runSandbox);
    }
  });
});
