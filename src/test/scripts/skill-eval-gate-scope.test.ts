import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../../scripts/skill-eval-scope.sh", import.meta.url));

let hasBash = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
} catch {
  // bash unavailable — the suite below skips (CI runs it on ubuntu)
}

describe.runIf(hasBash)("skill-eval gate scope", () => {
  let diffStub: string;

  beforeAll(() => {
    // The SKILL.md rule reads the diff itself; the script reaches git through a
    // seam so the rule can be exercised without a throwaway repository.
    diffStub = join(mkdtempSync(join(tmpdir(), "scope-stub-")), "diff.sh");
    writeFileSync(diffStub, '#!/usr/bin/env bash\nprintf "%s\\n" "${DIFF_OUT:-}"\n');
    chmodSync(diffStub, 0o755);
  });

  const decide = (changed: string[], diffOut = ""): string =>
    execFileSync("bash", [SCRIPT, "origin/master"], {
      input: changed.join("\n"),
      encoding: "utf-8",
      env: { ...process.env, SKILL_EVAL_DIFF_CMD: diffStub, DIFF_OUT: diffOut },
    }).trim();

  // The saving this rule exists for: a support file cannot reach a gate prompt,
  // so a PR that only moves one owes no gate run at all.
  it("skips the suite for a support file under a skill directory", () => {
    expect(decide(["plugin/skills/do/open-prs/forward.md"])).toBe("skip");
  });

  it("skips for docs", () => {
    expect(decide(["README.md"])).toBe("skip");
  });

  it("runs everything when the eval harness changes", () => {
    expect(decide(["internal/skill-gate-eval/src/harness.ts"])).toBe("full");
  });

  // A gate contract is inlined into every gate's prompt, so it is the one
  // support-shaped file that must still force the full suite.
  it("runs everything when a preference gate contract changes", () => {
    expect(decide(["plugin/skills/muggle-preferences/preference-gates/checkForUpdates.md"])).toBe(
      "full",
    );
  });

  it("runs everything when a SKILL.md body line changes", () => {
    expect(decide(["plugin/skills/muggle-status/SKILL.md"], "+Some new instruction")).toBe("full");
  });

  it("scopes to the skill when only its model: line changed", () => {
    expect(
      decide(["plugin/skills/muggle-status/SKILL.md"], "-model: sonnet\n+model: haiku"),
    ).toBe("scoped muggle-status");
  });

  it("ignores a support file riding alongside a model-only change", () => {
    expect(
      decide(
        ["plugin/skills/muggle-status/SKILL.md", "plugin/skills/do/open-prs/forward.md"],
        "-model: sonnet\n+model: haiku",
      ),
    ).toBe("scoped muggle-status");
  });
});
