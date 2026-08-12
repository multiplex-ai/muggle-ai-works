/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins the E2E run-instructions stage. Three properties are load-bearing and
 * each fails silently in the field if the prose drifts:
 *
 * 1. The file must never carry a credential value. It is created inside the
 *    user's repository and nothing in this codebase gitignores `.muggle-ai/`,
 *    so a secret written there gets committed and pushed.
 * 2. It must not restate a per-service start command. `prepare-plan.json` owns
 *    those; two copies drift and the stale one wins whichever is read first.
 * 3. The shared validation-context procedure may read the file but must never
 *    markdown-link into `muggle-test-prepare/` — that skill already links into
 *    `_shared/`, so a link back closes a cycle.
 *
 * Prose is the implementation here. These assertions do NOT catch an agent that
 * reads the contract correctly and ignores it.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS_DIR = path.join(REPO_ROOT, "plugin", "skills");
const PREPARE_DIR = path.join(SKILLS_DIR, "muggle-test-prepare");

const STAGE_DOC = path.join(PREPARE_DIR, "steps", "e2e-instructions.md");
const PREPARE_SKILL_DOC = path.join(PREPARE_DIR, "SKILL.md");
const REUSE_PLAN_DOC = path.join(PREPARE_DIR, "steps", "reuse-plan.md");
const READINESS_DOC = path.join(PREPARE_DIR, "steps", "readiness-report.md");
const VALIDATION_CONTEXT_DOC = path.join(
  SKILLS_DIR,
  "_shared",
  "resolve-e2e-validation-context.md",
);

const read = (docPath: string): string => fs.readFileSync(docPath, "utf8");

describe("parser sanity: refuse to pass vacuously", () => {
  it("every document under test exists and is non-trivial", () => {
    for (const docPath of [
      STAGE_DOC,
      PREPARE_SKILL_DOC,
      REUSE_PLAN_DOC,
      READINESS_DOC,
      VALIDATION_CONTEXT_DOC,
    ]) {
      expect(fs.existsSync(docPath), `missing: ${docPath}`).toBe(true);
      expect(read(docPath).length, `suspiciously short: ${docPath}`).toBeGreaterThan(200);
    }
  });
});

describe("stage contract", () => {
  it("names the durable file it writes, under the Muggle home directory", () => {
    expect(read(STAGE_DOC)).toMatch(/~\/\.muggle-ai\/e2e-instructions\//);
  });

  it("declares its dependency on the resolved service list", () => {
    // The prerequisite is the data, not a slot in the running order.
    const doc = read(STAGE_DOC);
    expect(doc).toMatch(/\[identify-services\]/);
    expect(doc).toMatch(/service (list|set)/i);
  });

  it("forbids restating a start command owned by the prepare plan", () => {
    const doc = read(STAGE_DOC);
    expect(doc).toMatch(/prepare-plan\.json/);
    expect(doc).toMatch(/never restate a command|reference the plan/i);
  });

  it("records a sentinel so an empty answer is not re-asked every run", () => {
    const doc = read(STAGE_DOC);
    expect(doc).toMatch(/sentinel/i);
    expect(doc).toMatch(/not\s+re-ask|do not re-ask/i);
  });
});

describe("credentials never reach the file", () => {
  it("the stage forbids writing a credential value and requires a pointer", () => {
    const doc = read(STAGE_DOC);
    expect(doc).toMatch(/never write a credential/i);
    expect(doc).toMatch(/pointer/i);
  });

  it("the write step repeats the rule where the write actually happens", () => {
    expect(read(READINESS_DOC)).toMatch(/never write a credential/i);
  });

  it("the skill lists it as a guardrail", () => {
    expect(read(PREPARE_SKILL_DOC)).toMatch(/never write a credential/i);
  });
});

describe("machine-local storage, never the user's project", () => {
  const DOCS_NAMING_THE_FILE = [
    STAGE_DOC,
    PREPARE_SKILL_DOC,
    REUSE_PLAN_DOC,
    READINESS_DOC,
    VALIDATION_CONTEXT_DOC,
    path.join(SKILLS_DIR, "muggle-test", "execute-local.md"),
    path.join(SKILLS_DIR, "muggle-test-feature-local", "SKILL.md"),
  ];

  it("no document routes saved state into the user's repository", () => {
    for (const docPath of DOCS_NAMING_THE_FILE) {
      // Covers every file this skill saves — the prepare plan as well as the run
      // instructions. A repo-relative path puts user-level machine state under
      // version control and ships one developer's local setup to everyone who clones.
      expect(read(docPath), `repo-local path in ${path.basename(docPath)}`).not.toMatch(
        /(<repo>|\$REPO)\/\.muggle-ai\//,
      );
    }
  });

  it("resolving saved state needs no version-control tool", () => {
    for (const docPath of [STAGE_DOC, REUSE_PLAN_DOC, READINESS_DOC]) {
      expect(read(docPath), `VCS call in ${path.basename(docPath)}`).not.toMatch(
        /\bgit\s+rev-parse\b/,
      );
    }
  });

  it("the stage says so explicitly", () => {
    expect(read(STAGE_DOC)).toMatch(/never inside the user's project/i);
  });
});

describe("the stage stays VCS-agnostic and OS-agnostic", () => {
  it("resolves its location without invoking a version-control tool", () => {
    // The file is keyed on a working directory, not a checkout; requiring `git`
    // would break the stage for anyone on another VCS or outside a repo at all.
    expect(read(STAGE_DOC)).not.toMatch(/\bgit\s+(rev-parse|status|config)\b/);
  });

  it("does not assume a platform path separator when deriving the key", () => {
    const doc = read(STAGE_DOC);
    expect(doc).toMatch(/resolved absolute path/i);
    expect(doc).toMatch(/differ per platform|per platform/i);
  });
});

describe("reuse rides the existing prepare-plan gate", () => {
  it("the stage gates on reusePreparePlan and invents no new preference key", () => {
    const doc = read(STAGE_DOC);
    expect(doc).toMatch(/reusePreparePlan/);
    expect(doc).not.toMatch(/reuseE2eInstructions/i);
  });

  it("the skill's Preferences table still keys the gate as reusePreparePlan", () => {
    expect(read(PREPARE_SKILL_DOC)).toMatch(/\|\s*`reusePreparePlan`\s*\|/);
  });

  it("the short-circuit path skips the stage and carries saved instructions forward", () => {
    const doc = read(REUSE_PLAN_DOC);
    expect(doc).toMatch(/e2e-instructions/);
    expect(doc).toMatch(/not\s+re-asked/i);
  });
});

describe("workflow wiring", () => {
  it("the Decide-phase table lists the stage", () => {
    // Presence only. The table carries no ordinal column, so asserting one would
    // re-introduce the positional coupling the steps were just freed from.
    expect(read(PREPARE_SKILL_DOC)).toMatch(
      /\|\s*\[e2e-instructions\]\(\.\/steps\/e2e-instructions\.md\)\s*\|/,
    );
  });

  it("the write step persists the instructions", () => {
    expect(read(READINESS_DOC)).toMatch(/e2e-instructions/);
  });
});

describe("no dependency cycle back into muggle-test-prepare", () => {
  it("the shared validation context reads the file", () => {
    expect(read(VALIDATION_CONTEXT_DOC)).toMatch(/e2e-instructions\//);
  });

  it("the shared validation context does not markdown-link into muggle-test-prepare", () => {
    // `muggle-test-prepare` links into `_shared/`; a link back would close a cycle
    // that check-skill-deps.mjs rejects. Referencing the file by path is fine.
    expect(read(VALIDATION_CONTEXT_DOC)).not.toMatch(
      /\]\([^)]*muggle-test-prepare\//,
    );
  });
});

/**
 * The prepare skill learns once and replays thereafter. Each rule below pins a
 * point where that collapses back into re-interrogating the user every run —
 * the behaviour the lifecycle exists to remove.
 */
describe("prepare learns once, then replays", () => {
  const STEPS = path.join(PREPARE_DIR, "steps");
  const replayOrLearn = path.join(STEPS, "replay-or-learn.md");
  const deriveServiceGraph = path.join(STEPS, "derive-service-graph.md");
  const confirmRecipe = path.join(STEPS, "confirm-recipe.md");
  const recordResolution = path.join(STEPS, "record-resolution.md");

  it("has a stage that chooses replay over learning before anything else", () => {
    expect(fs.existsSync(replayOrLearn)).toBe(true);
    const doc = read(replayOrLearn);
    expect(doc).toMatch(/no scan, no interview/i);
  });

  it("a replay asks nothing unless hard-blocked", () => {
    const doc = read(replayOrLearn);
    expect(doc).toMatch(/hard block/i);
    // A replay that re-prompts has undone the learning.
    expect(doc).toMatch(/only a .*hard block.*may|Only a \[hard block\]/i);
  });

  it("defines hard block narrowly enough to stay rare", () => {
    const doc = read(confirmRecipe);
    expect(doc).toMatch(/recorded resolutions do not cover/i);
    expect(doc).toMatch(/autonomous attempts cannot clear/i);
    // A transient must not qualify, or every flake re-opens the interview.
    expect(doc).toMatch(/transient/i);
  });

  it("no step file encodes its position in the sequence", () => {
    // A title that names its slot ("Stage 5", "Final stage") is wrong the moment
    // a stage is inserted — which already happened once. Steps state what they
    // need, never where they sit.
    for (const entry of fs.readdirSync(STEPS)) {
      if (!entry.endsWith(".md")) continue;
      const title = read(path.join(STEPS, entry)).split(/\r?\n/)[0];
      expect(title, `${entry} pins itself to a position: ${title}`).not.toMatch(
        /^#\s*(Stage\s*\d+|Final stage|Step\s*\d+)/i,
      );
    }
  });

  it("states prerequisites as data, not as position", () => {
    // "Runs after X" breaks on reorder; "needs X's output" stays true.
    for (const entry of fs.readdirSync(STEPS)) {
      if (!entry.endsWith(".md")) continue;
      expect(read(path.join(STEPS, entry)), `${entry} couples to run order`).not.toMatch(
        /^Runs after /m,
      );
    }
  });

  it("asks permission before reading any code", () => {
    const doc = read(deriveServiceGraph);
    // Reading a user's repo is granted, never assumed.
    expect(doc).toMatch(/Nothing is read until the user says where/i);
    expect(doc).toMatch(/I'll list them/);
    expect(doc).toMatch(/2 levels|depth/i);
    // The grant is remembered, so the ask does not repeat every run.
    expect(doc).toMatch(/Record the granted scope|reuses the same permission/i);
  });

  it("confines reading to the granted scope", () => {
    const doc = read(deriveServiceGraph);
    expect(doc).toMatch(/only inside the folder the user granted/i);
    expect(read(PREPARE_SKILL_DOC)).toMatch(/granted, never assumed/i);
  });

  it("scans the workspace instead of only listing folder names", () => {
    const doc = read(deriveServiceGraph);
    expect(doc).toMatch(/pnpm-workspace|workspaces|turbo\.json/);
    expect(doc).toMatch(/docker-compose|Procfile/);
    // What the scan settles must not be asked again.
    expect(read(path.join(STEPS, "identify-services.md"))).toMatch(
      /already derived|Start from the scan/i,
    );
  });

  it("never guesses a port the workspace didn't declare", () => {
    expect(read(deriveServiceGraph)).toMatch(/never a framework default|undeclared port is unknown/i);
  });

  it("gates persistence behind exactly one end-of-run confirmation", () => {
    const doc = read(confirmRecipe);
    expect(doc).toMatch(/Remember it/);
    expect(doc).toMatch(/Don't remember|Do not remember/);
    // Declining must leave nothing behind, or the gate is decorative.
    expect(doc).toMatch(/Write nothing/i);
    expect(read(path.join(STEPS, "readiness-report.md"))).toMatch(
      /only once the user has accepted|accepted the gate/i,
    );
  });

  it("consults a recorded resolution before asking the user again", () => {
    const doc = read(recordResolution);
    expect(doc).toMatch(/consult before attempting|Consult the recipe first/i);
    for (const stage of ["smoke-test.md", "start-services.md"]) {
      expect(read(path.join(STEPS, stage)), `${stage} does not consult recorded resolutions`)
        .toMatch(/record-resolution/);
    }
  });

  it("refuses to record a transient or an unresolved failure as a resolution", () => {
    const doc = read(recordResolution);
    expect(doc).toMatch(/transient that cleared on retry/i);
    expect(doc).toMatch(/never cleared is not a resolution/i);
  });

  it("keeps machine-observed resolutions separate from the user's own words", () => {
    const doc = read(path.join(STEPS, "e2e-instructions.md"));
    expect(doc).toMatch(/^## Resolutions$/m);
    expect(doc).toMatch(/never rewritten by a run|user's own words/i);
  });

  it("still forbids credentials on the write-back path", () => {
    expect(read(recordResolution)).toMatch(/credential/i);
  });
});
