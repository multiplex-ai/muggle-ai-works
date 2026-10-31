import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { isArtifactSatisfied } from "../src/sandbox/artifacts.js";
import { normalizePathText, resolveSandboxPath, sandboxPathSpellings } from "../src/sandbox/paths.js";
import {
  createRunSandbox,
  removeRunSandbox,
  resolveFixtureRepo,
  sandboxPathContext,
  sandboxResumeConfigDirs,
  sandboxSessionRecordsDir,
  snapshotArtifacts,
} from "../src/sandbox/sandbox.js";
import type { ArtifactSnapshot, SandboxPathContext, ToolAttempt } from "../src/types.js";

const realHome = path.join(os.tmpdir(), "users", "dev");
// The sandbox nests under the real home, as the OS temp dir does on Windows.
const root = path.join(realHome, "AppData", "Local", "Temp", "muggle-agent-eval-run-1");
const paths: SandboxPathContext = {
  root: root,
  home: path.join(root, "home"),
  repo: path.join(root, "repo"),
  realHome: realHome,
  passthroughRoots: [path.join(realHome, "Github", "works", "plugin")],
};
const sessionSlot = path.join(paths.home, ".muggle-ai", "muggle-do", "sessions", "s");

describe("resolveSandboxPath", () => {
  it("redirects ~ and $HOME spellings into the sandbox home", () => {
    for (const spelling of ["~/.muggle-ai/muggle-do/sessions/s", "$HOME/.muggle-ai/muggle-do/sessions/s", "${HOME}/.muggle-ai/muggle-do/sessions/s"]) {
      expect(resolveSandboxPath(spelling, paths), spelling).toBe(sessionSlot);
    }
    expect(resolveSandboxPath("~", paths)).toBe(paths.home);
  });

  it.runIf(path.sep === "\\")("redirects the Windows ~\\ spelling into the sandbox home", () => {
    expect(resolveSandboxPath("~\\.muggle-ai\\muggle-do\\sessions\\s", paths)).toBe(sessionSlot);
  });

  it.runIf(path.sep === "/")("treats ~\\ as an ordinary relative file name where backslash is not a separator", () => {
    expect(resolveSandboxPath("~\\notes", paths)).toBe(path.join(paths.repo, "~\\notes"));
  });

  it("redirects an absolute path under the real home, as the SDK hands `~` paths to hooks", () => {
    expect(resolveSandboxPath(path.join(realHome, ".muggle-ai", "muggle-do", "sessions", "s"), paths)).toBe(sessionSlot);
  });

  it("leaves a path already inside the sandbox where it is, though the sandbox sits under the real home", () => {
    const inRepo = path.join(paths.repo, "src", "greeting.js");
    expect(resolveSandboxPath(inRepo, paths)).toBe(inRepo);
  });

  it("leaves a passthrough root's paths where they are, though the plugin checkout sits under the real home", () => {
    const stageFile = path.join(paths.passthroughRoots[0], "skills", "do", "input-routing.md");
    expect(resolveSandboxPath(stageFile, paths)).toBe(stageFile);
  });

  it("resolves a relative path in the repo and leaves other absolute paths alone", () => {
    expect(resolveSandboxPath("src/greeting.js", paths)).toBe(path.join(paths.repo, "src", "greeting.js"));
    const elsewhere = path.join(os.tmpdir(), "elsewhere", "x.md");
    expect(resolveSandboxPath(elsewhere, paths)).toBe(elsewhere);
  });
});

describe("sandboxPathSpellings", () => {
  it("covers the sandbox, real-home, ~ and $HOME spellings of a home path", () => {
    const spellings = sandboxPathSpellings("~/.muggle-ai/muggle-do/sessions/s/prs.json", paths);
    expect(spellings).toContain(normalizePathText(path.join(sessionSlot, "prs.json")));
    expect(spellings).toContain(normalizePathText(path.join(realHome, ".muggle-ai", "muggle-do", "sessions", "s", "prs.json")));
    expect(spellings).toContain(normalizePathText("~/.muggle-ai/muggle-do/sessions/s/prs.json"));
    expect(spellings).toContain(normalizePathText("$HOME/.muggle-ai/muggle-do/sessions/s/prs.json"));
  });
});

describe("isArtifactSatisfied", () => {
  const prsJson = "~/.muggle-ai/muggle-do/sessions/s/prs.json";
  const snapshotWith = (fileContent: string | null): ArtifactSnapshot => ({
    paths: paths,
    fileContents: { [prsJson]: fileContent },
  });
  const bash = (command: string): ToolAttempt => ({ tool: "Bash", args: { command: command } });

  it("is satisfied by the sandbox file, checking `contains` against its content", () => {
    expect(isArtifactSatisfied({ path: prsJson, contains: "\"number\": 7" }, snapshotWith('{ "number": 7 }'), [])).toBe(true);
    expect(isArtifactSatisfied({ path: prsJson, contains: "\"number\": 8" }, snapshotWith('{ "number": 7 }'), [])).toBe(false);
  });

  it("is satisfied by a Bash attempt naming the path in any home spelling, since Bash never runs", () => {
    for (const command of [
      `cat > ~/.muggle-ai/muggle-do/sessions/s/prs.json <<'EOF'\n{"number": 7}\nEOF`,
      `jq -n '{number: 7}' > "$HOME/.muggle-ai/muggle-do/sessions/s/prs.json"`,
      `echo '{"number": 7}' > ${path.join(realHome, ".muggle-ai", "muggle-do", "sessions", "s", "prs.json")}`,
    ]) {
      expect(isArtifactSatisfied({ path: prsJson, contains: "number" }, snapshotWith(null), [bash(command)]), command).toBe(true);
    }
  });

  it("is satisfied by a Bash attempt reaching the path through a cd or a directory variable, as a shell would", () => {
    for (const command of [
      `cd ~/.muggle-ai/muggle-do/sessions/s && echo '{"number": 7}' > prs.json`,
      `cd "$HOME/.muggle-ai/muggle-do/sessions" && echo '{"number": 7}' >> s/prs.json`,
      `SLOT=~/.muggle-ai/muggle-do/sessions/s; echo '{"number": 7}' > "$SLOT/prs.json"`,
      `SLOT="$HOME/.muggle-ai/muggle-do/sessions/s" && echo '{"number": 7}' > \${SLOT}/prs.json`,
    ]) {
      expect(isArtifactSatisfied({ path: prsJson, contains: "number" }, snapshotWith(null), [bash(command)]), command).toBe(true);
    }
  });

  // printf turns `\n` into a newline, so a marker after it starts a line in the written file.
  it("reads the escapes printf writes when matching a Bash attempt's content", () => {
    const marker = { path: prsJson, matches: "(^|\\n)Stage 2 done — " };
    const printfMarker = bash(`printf '\\nStage 2 done — requirements written\\n' >> ~/.muggle-ai/muggle-do/sessions/s/prs.json`);
    expect(isArtifactSatisfied(marker, snapshotWith(null), [printfMarker])).toBe(true);
    const noMarker = bash(`printf '\\nStage 2 pending\\n' >> ~/.muggle-ai/muggle-do/sessions/s/prs.json`);
    expect(isArtifactSatisfied(marker, snapshotWith(null), [noMarker])).toBe(false);
  });

  it("is not satisfied by a relative path the command never anchors in the artifact's directory", () => {
    for (const command of [
      `cd ~/.muggle-ai/muggle-do/sessions/other && echo '{"number": 7}' > prs.json`,
      `echo '{"number": 7}' > prs.json`,
      `cd ~/.muggle-ai/muggle-do/sessions/s && echo '{"number": 7}' > notprs.json`,
      `OTHER=~/.muggle-ai/muggle-do/sessions/other; echo '{"number": 7}' > "$OTHER/prs.json"`,
    ]) {
      expect(isArtifactSatisfied({ path: prsJson, contains: "number" }, snapshotWith(null), [bash(command)]), command).toBe(false);
    }
  });

  it("is not satisfied by a Bash attempt that names the path without the expected content, or names another file", () => {
    expect(
      isArtifactSatisfied({ path: prsJson, contains: "\"number\"" }, snapshotWith(null), [bash("touch ~/.muggle-ai/muggle-do/sessions/s/prs.json")]),
    ).toBe(false);
    expect(
      isArtifactSatisfied({ path: prsJson }, snapshotWith(null), [bash("cat > ~/.muggle-ai/muggle-do/sessions/s/state.md")]),
    ).toBe(false);
  });

  it("is satisfied by a Write attempt to the path, in any spelling, carrying the content", () => {
    const write = (filePath: string, content: string): ToolAttempt => ({ tool: "Write", args: { file_path: filePath, content: content } });
    expect(isArtifactSatisfied({ path: prsJson, contains: "7" }, snapshotWith(null), [write(path.join(sessionSlot, "prs.json"), "{\"number\":7}")])).toBe(true);
    expect(isArtifactSatisfied({ path: prsJson, contains: "7" }, snapshotWith(null), [write(path.join(realHome, ".muggle-ai", "muggle-do", "sessions", "s", "prs.json"), "7")])).toBe(true);
    expect(isArtifactSatisfied({ path: prsJson, contains: "7" }, snapshotWith(null), [write(path.join(sessionSlot, "prs.json"), "{}")])).toBe(false);
  });
});

describe("createRunSandbox", () => {
  it("copies the fixture repo, seeds home and repo files, snapshots artifacts, and removes everything", () => {
    const sandbox = createRunSandbox({
      repo: "tiny-web-app",
      files: [
        { path: "~/.muggle-ai/muggle-do/sessions/s/state.md", content: "stage: 5" },
        { path: "notes/plan.md", content: "plan" },
      ],
    });
    try {
      expect(fs.existsSync(path.join(sandbox.repo, "package.json"))).toBe(true);
      expect(fs.existsSync(path.join(sandbox.repo, "src", "greeting.js"))).toBe(true);
      expect(fs.readFileSync(path.join(sandbox.repo, "notes", "plan.md"), "utf8")).toBe("plan");
      const snapshot = snapshotArtifacts(
        [{ path: "~/.muggle-ai/muggle-do/sessions/s/state.md" }, { path: "~/.muggle-ai/muggle-do/sessions/s/prs.json" }],
        sandboxPathContext(sandbox),
      );
      expect(snapshot.fileContents).toEqual({
        "~/.muggle-ai/muggle-do/sessions/s/state.md": "stage: 5",
        "~/.muggle-ai/muggle-do/sessions/s/prs.json": null,
      });
    } finally {
      removeRunSandbox(sandbox);
    }
    expect(fs.existsSync(sandbox.root)).toBe(false);
  });

  it("also removes the records the CLI keeps for the sandbox repo, under CLAUDE_CONFIG_DIR when set", () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-gate-eval-config-"));
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    try {
      const sandbox = createRunSandbox();
      const recordsDir = sandboxSessionRecordsDir(sandbox);
      expect(path.dirname(recordsDir)).toBe(path.join(configDir, "projects"));
      expect(path.basename(recordsDir)).toMatch(/^[A-Za-z0-9-]+muggle-agent-eval-run-[A-Za-z0-9-]+-repo$/);
      fs.mkdirSync(path.join(recordsDir, "memory"), { recursive: true });
      removeRunSandbox(sandbox);
      expect(fs.existsSync(recordsDir)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("removes the temporary config directory the SDK resumed this run in, and no other run's", () => {
    const sandbox = createRunSandbox();
    const otherSandbox = createRunSandbox();
    const projectDir = (runSandbox: typeof sandbox) => runSandbox.repo.replace(/[^A-Za-z0-9]/g, "-");
    const ownResumeDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-resume-"));
    const otherResumeDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-resume-"));
    try {
      fs.mkdirSync(path.join(ownResumeDir, "projects", projectDir(sandbox)), { recursive: true });
      fs.writeFileSync(path.join(ownResumeDir, ".credentials.json"), "{}");
      fs.mkdirSync(path.join(otherResumeDir, "projects", projectDir(otherSandbox)), { recursive: true });
      expect(sandboxResumeConfigDirs(sandbox)).toEqual([ownResumeDir]);
      removeRunSandbox(sandbox);
      expect(fs.existsSync(ownResumeDir)).toBe(false);
      expect(fs.existsSync(otherResumeDir)).toBe(true);
    } finally {
      removeRunSandbox(otherSandbox);
      fs.rmSync(ownResumeDir, { recursive: true, force: true });
      fs.rmSync(otherResumeDir, { recursive: true, force: true });
    }
    expect(fs.existsSync(otherResumeDir)).toBe(false);
  });

  it("fills {{home}} and {{repo}} in seed content with the run's own sandbox paths", () => {
    const sandbox = createRunSandbox({
      files: [{ path: "~/.muggle-ai/muggle-do/sessions/s/state.md", content: "- Working tree: {{repo}}\n- Slot: {{home}}/.muggle-ai" }],
    });
    try {
      expect(fs.readFileSync(path.join(sandbox.home, ".muggle-ai", "muggle-do", "sessions", "s", "state.md"), "utf8")).toBe(
        `- Working tree: ${sandbox.repo}\n- Slot: ${sandbox.home}/.muggle-ai`,
      );
    } finally {
      removeRunSandbox(sandbox);
    }
  });

  it("starts with an empty repo when the seed names none", () => {
    const sandbox = createRunSandbox();
    try {
      expect(fs.readdirSync(sandbox.repo)).toEqual([]);
      expect(fs.readdirSync(sandbox.home)).toEqual([]);
    } finally {
      removeRunSandbox(sandbox);
    }
  });

  it("refuses a seed file that would land outside the sandbox home and repo", () => {
    for (const seedPath of ["../escape.md", "../../escape.md", "~/../escape.md", path.join(os.tmpdir(), "abs.md")]) {
      expect(() => createRunSandbox({ files: [{ path: seedPath, content: "x" }] }), seedPath).toThrow(/inside the sandbox/);
    }
    expect(fs.existsSync(path.join(os.tmpdir(), "abs.md"))).toBe(false);
  });

  it("refuses a seed repo that is not a fixture directory", () => {
    expect(() => resolveFixtureRepo("../src")).toThrow(/not a fixture directory/);
    expect(() => resolveFixtureRepo("no-such-fixture")).toThrow(/not a fixture directory/);
  });
});
