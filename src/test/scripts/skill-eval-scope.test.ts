import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/skill-eval.yml", import.meta.url),
);

// The predicate under test lives in the workflow's `Determine scope` shell, so
// it is read back from the file rather than duplicated here — a copy would keep
// passing after someone edits the workflow, which is the failure this pins.
function harnessPredicate(): string {
  const workflow = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
  const line = workflow
    .split("\n")
    .find((l) => l.includes("internal/skill-routing-eval/") && l.includes("grep -vE"));
  if (!line) throw new Error("harness-change predicate not found in skill-eval.yml");
  const filter = line.slice(line.indexOf("| grep -vE"), line.lastIndexOf("; then"));
  return `printf '%s\n' "$FILES" ${filter}`;
}

let hasBash = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
} catch {
  // bash unavailable — the suite below skips
}

/** True when the changed-file list would trigger a routing sweep. */
function triggersSweep(changedFiles: string[]): boolean {
  try {
    execFileSync("bash", ["-c", harnessPredicate()], {
      env: { ...process.env, FILES: changedFiles.join("\n") },
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(hasBash)("skill-eval routing scope — harness changes", () => {
  it("sweeps when the route parser changes", () => {
    expect(triggersSweep(["internal/skill-routing-eval/router_eval.py"])).toBe(true);
  });

  it("sweeps when the pass rule changes", () => {
    expect(triggersSweep(["internal/skill-routing-eval/scoring.py"])).toBe(true);
  });

  it("sweeps when the recorded baseline changes", () => {
    expect(triggersSweep(["internal/skill-routing-eval/recall-baseline.json"])).toBe(true);
  });

  it("sweeps when scoring code ships alongside its own tests", () => {
    expect(
      triggersSweep([
        "internal/skill-routing-eval/router_eval.py",
        "internal/skill-routing-eval/test_router_eval.py",
      ]),
    ).toBe(true);
  });

  // A sweep is ~25 minutes of real LLM calls, so changes that cannot reach
  // scoring must not pay for one.
  it("does not sweep for documentation alone", () => {
    expect(triggersSweep(["internal/skill-routing-eval/README.md"])).toBe(false);
  });

  it("does not sweep for tests alone", () => {
    expect(
      triggersSweep([
        "internal/skill-routing-eval/test_router_eval.py",
        "internal/skill-routing-eval/test_scoring.py",
      ]),
    ).toBe(false);
  });

  it("does not sweep when nothing under the harness changed", () => {
    expect(triggersSweep([])).toBe(false);
  });
});

describe("skill-eval CLI pin", () => {
  it("pins every Claude CLI install to the workflow version", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).not.toMatch(/npm install -g @anthropic-ai\/claude-code\s*$/m);
    const pinned = workflow.match(
      /npm install -g "@anthropic-ai\/claude-code@\$\{CLAUDE_CLI_VERSION\}"/g,
    );
    expect(pinned?.length).toBe(3);
  });

  it("records the resolved version after each install", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow.match(/claude --version/g)?.length).toBe(3);
  });
});
