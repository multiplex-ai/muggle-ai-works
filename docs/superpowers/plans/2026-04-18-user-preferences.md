# User Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent user preference system to Muggle AI that lets skills and MCP tools read behavioral knobs (auto-login, show browser, suggest test cases, etc.) without burning tokens, and lets users change preferences conversationally or by editing the JSON file.

**Architecture:** Preferences live in `~/.muggle-ai/preferences.json` (global) with optional per-project overrides in `.muggle-ai/preferences.json`. A SessionStart hook prints resolved preferences into session context so skills see them for free. MCP tools import a `PreferencesService` directly (zero tokens). One write-only MCP tool `muggle-local-preferences-set` handles conversational changes. `muggle setup` writes defaults on first run.

**Tech Stack:** TypeScript, Zod, Vitest, Bash (hook script)

---

### Task 1: Preference Types and Constants

**Files:**
- Create: `packages/mcps/src/shared/preferences-types.ts`
- Create: `packages/mcps/src/shared/preferences-constants.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/mcps/src/test/preferences.test.ts`:

```typescript
/**
 * Tests for the preferences type system and constants.
 */

import { describe, expect, it } from "vitest";

import {
  PreferenceKey,
  PreferenceValue,
} from "../shared/preferences-types.js";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_FILE_NAME,
  PREFERENCES_SCHEMA,
  PREFERENCES_VERSION,
} from "../shared/preferences-constants.js";

describe("PreferenceKey enum", () => {
  it("has exactly 12 keys", () => {
    const keys = Object.values(PreferenceKey);
    expect(keys).toHaveLength(12);
  });

  it("contains all expected keys", () => {
    expect(PreferenceKey.AutoLogin).toBe("autoLogin");
    expect(PreferenceKey.AutoSelectProject).toBe("autoSelectProject");
    expect(PreferenceKey.ShowElectronBrowser).toBe("showElectronBrowser");
    expect(PreferenceKey.OpenTestResultsAfterRun).toBe("openTestResultsAfterRun");
    expect(PreferenceKey.DefaultExecutionMode).toBe("defaultExecutionMode");
    expect(PreferenceKey.AutoPublishLocalResults).toBe("autoPublishLocalResults");
    expect(PreferenceKey.SuggestRelatedUseCases).toBe("suggestRelatedUseCases");
    expect(PreferenceKey.SuggestRelatedTestCases).toBe("suggestRelatedTestCases");
    expect(PreferenceKey.AutoDetectChanges).toBe("autoDetectChanges");
    expect(PreferenceKey.PostPRVisualWalkthrough).toBe("postPRVisualWalkthrough");
    expect(PreferenceKey.CheckForUpdates).toBe("checkForUpdates");
    expect(PreferenceKey.VerboseOutput).toBe("verboseOutput");
  });
});

describe("PreferenceValue enum", () => {
  it("has exactly 3 values", () => {
    expect(Object.values(PreferenceValue)).toHaveLength(3);
  });

  it("contains always, ask, never", () => {
    expect(PreferenceValue.Always).toBe("always");
    expect(PreferenceValue.Ask).toBe("ask");
    expect(PreferenceValue.Never).toBe("never");
  });
});

describe("DEFAULT_PREFERENCES", () => {
  it("has an entry for every PreferenceKey", () => {
    for (const key of Object.values(PreferenceKey)) {
      expect(DEFAULT_PREFERENCES).toHaveProperty(key);
    }
  });

  it("defaults every key to ask", () => {
    for (const value of Object.values(DEFAULT_PREFERENCES)) {
      expect(value).toBe(PreferenceValue.Ask);
    }
  });
});

describe("PREFERENCES_SCHEMA", () => {
  it("has a description for every PreferenceKey", () => {
    for (const key of Object.values(PreferenceKey)) {
      expect(PREFERENCES_SCHEMA[key]).toBeDefined();
      expect(PREFERENCES_SCHEMA[key].description).toBeTruthy();
    }
  });
});

describe("constants", () => {
  it("exports correct file name", () => {
    expect(PREFERENCES_FILE_NAME).toBe("preferences.json");
  });

  it("exports version 1", () => {
    expect(PREFERENCES_VERSION).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/stan/Github/muggle-ai-works && npx vitest run packages/mcps/src/test/preferences.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Create preferences-types.ts**

Create `packages/mcps/src/shared/preferences-types.ts`:

```typescript
/**
 * Type definitions for the user preferences system.
 */

/**
 * Preference keys — one per behavioral knob.
 */
export enum PreferenceKey {
  /** Reuse saved credentials when a tool requires auth. */
  AutoLogin = "autoLogin",
  /** Reuse the last-used Muggle project for this repo. */
  AutoSelectProject = "autoSelectProject",
  /** Show the Electron browser window during local E2E tests. */
  ShowElectronBrowser = "showElectronBrowser",
  /** Open the per-run results page on Muggle dashboard after local test completion. */
  OpenTestResultsAfterRun = "openTestResultsAfterRun",
  /** Default to local or remote test execution. */
  DefaultExecutionMode = "defaultExecutionMode",
  /** Upload local test results to Muggle cloud for team visibility. */
  AutoPublishLocalResults = "autoPublishLocalResults",
  /** Suggest related use cases after creating or running one. */
  SuggestRelatedUseCases = "suggestRelatedUseCases",
  /** Suggest related test cases after creating or running one. */
  SuggestRelatedTestCases = "suggestRelatedTestCases",
  /** Scan local git changes and map to affected test cases. */
  AutoDetectChanges = "autoDetectChanges",
  /** Post visual walkthrough comment with screenshots to the PR. */
  PostPRVisualWalkthrough = "postPRVisualWalkthrough",
  /** Check for newer Muggle versions at session start. */
  CheckForUpdates = "checkForUpdates",
  /** Show detailed progress logs during execution. */
  VerboseOutput = "verboseOutput",
}

/**
 * Allowed values for every preference knob.
 */
export enum PreferenceValue {
  /** Proceed without asking. */
  Always = "always",
  /** Ask the user each time. */
  Ask = "ask",
  /** Skip without asking. */
  Never = "never",
}

/**
 * Map of all preference keys to their values.
 */
export type IPreferences = Record<PreferenceKey, PreferenceValue>;

/**
 * Partial preferences — used for per-project overrides.
 */
export type IPartialPreferences = Partial<IPreferences>;

/**
 * On-disk preferences file shape.
 */
export interface IPreferencesFile {
  /** Schema version for future migrations. */
  version: number;
  /** The preference key-value pairs. */
  preferences: IPartialPreferences;
}

/**
 * Schema entry describing a single preference knob.
 */
export interface IPreferenceSchemaEntry {
  /** Human-readable description of what this knob gates. */
  description: string;
}
```

- [ ] **Step 4: Create preferences-constants.ts**

Create `packages/mcps/src/shared/preferences-constants.ts`:

```typescript
/**
 * Constants for the user preferences system.
 */

import {
  PreferenceKey,
  PreferenceValue,
  type IPreferences,
  type IPreferenceSchemaEntry,
} from "./preferences-types.js";

/** Preferences file name (used in both global and per-project paths). */
export const PREFERENCES_FILE_NAME = "preferences.json";

/** Per-project preferences subdirectory name. */
export const PREFERENCES_PROJECT_DIR_NAME = ".muggle-ai";

/** Current schema version. */
export const PREFERENCES_VERSION = 1;

/** Default preferences — every knob set to "ask". */
export const DEFAULT_PREFERENCES: IPreferences = {
  [PreferenceKey.AutoLogin]: PreferenceValue.Ask,
  [PreferenceKey.AutoSelectProject]: PreferenceValue.Ask,
  [PreferenceKey.ShowElectronBrowser]: PreferenceValue.Ask,
  [PreferenceKey.OpenTestResultsAfterRun]: PreferenceValue.Ask,
  [PreferenceKey.DefaultExecutionMode]: PreferenceValue.Ask,
  [PreferenceKey.AutoPublishLocalResults]: PreferenceValue.Ask,
  [PreferenceKey.SuggestRelatedUseCases]: PreferenceValue.Ask,
  [PreferenceKey.SuggestRelatedTestCases]: PreferenceValue.Ask,
  [PreferenceKey.AutoDetectChanges]: PreferenceValue.Ask,
  [PreferenceKey.PostPRVisualWalkthrough]: PreferenceValue.Ask,
  [PreferenceKey.CheckForUpdates]: PreferenceValue.Ask,
  [PreferenceKey.VerboseOutput]: PreferenceValue.Ask,
};

/** Human-readable schema for each preference — used in setup wizard and validation. */
export const PREFERENCES_SCHEMA: Record<PreferenceKey, IPreferenceSchemaEntry> = {
  [PreferenceKey.AutoLogin]: {
    description: "When a tool requires auth and saved credentials exist, reuse them without prompting",
  },
  [PreferenceKey.AutoSelectProject]: {
    description: "When a skill needs a Muggle project and one was used previously in this repo, reuse it without prompting",
  },
  [PreferenceKey.ShowElectronBrowser]: {
    description: "When running local E2E tests, show the Electron browser window",
  },
  [PreferenceKey.OpenTestResultsAfterRun]: {
    description: "After a local E2E test run completes, open the per-run results page on Muggle dashboard",
  },
  [PreferenceKey.DefaultExecutionMode]: {
    description: "When a skill supports both local and remote test execution, which to default to",
  },
  [PreferenceKey.AutoPublishLocalResults]: {
    description: "After a local E2E test run completes, upload results to Muggle cloud for team visibility",
  },
  [PreferenceKey.SuggestRelatedUseCases]: {
    description: "After creating or running a use case, suggest related use cases to add",
  },
  [PreferenceKey.SuggestRelatedTestCases]: {
    description: "After creating or running a test case, suggest related test cases to add",
  },
  [PreferenceKey.AutoDetectChanges]: {
    description: "When running muggle-test, scan local git changes and map to affected test cases",
  },
  [PreferenceKey.PostPRVisualWalkthrough]: {
    description: "After test results are available, post visual walkthrough comment with screenshots to the PR",
  },
  [PreferenceKey.CheckForUpdates]: {
    description: "At session start, check if a newer Muggle version is available and notify",
  },
  [PreferenceKey.VerboseOutput]: {
    description: "Show detailed progress logs during skill and tool execution",
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/stan/Github/muggle-ai-works && npx vitest run packages/mcps/src/test/preferences.test.ts`
Expected: PASS — all assertions green

- [ ] **Step 6: Commit**

```bash
git add packages/mcps/src/shared/preferences-types.ts packages/mcps/src/shared/preferences-constants.ts packages/mcps/src/test/preferences.test.ts
git commit -m "feat(preferences): add preference types, constants, and schema"
```

---

### Task 2: PreferencesService

**Files:**
- Create: `packages/mcps/src/shared/preferences.ts`
- Modify: `packages/mcps/src/test/preferences.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/mcps/src/test/preferences.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  readGlobalPreferences,
  readProjectPreferences,
  resolvePreferences,
  writePreferences,
  resetPreference,
  isFirstRun,
  validatePreference,
  formatPreferencesOneLiner,
} from "../shared/preferences.js";

// ... (keep existing tests above) ...

describe("PreferencesService", () => {
  let tempDir: string;
  let globalDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-prefs-test-"));
    globalDir = path.join(tempDir, "global", ".muggle-ai");
    projectDir = path.join(tempDir, "project");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("isFirstRun", () => {
    it("returns true when no preferences file exists", () => {
      expect(isFirstRun(globalDir)).toBe(true);
    });

    it("returns false when preferences file exists", () => {
      const filePath = path.join(globalDir, "preferences.json");
      fs.writeFileSync(filePath, JSON.stringify({ version: 1, preferences: {} }));
      expect(isFirstRun(globalDir)).toBe(false);
    });
  });

  describe("readGlobalPreferences", () => {
    it("returns defaults when file does not exist", () => {
      const prefs = readGlobalPreferences(globalDir);
      expect(prefs).toEqual(DEFAULT_PREFERENCES);
    });

    it("reads saved preferences", () => {
      const filePath = path.join(globalDir, "preferences.json");
      fs.writeFileSync(filePath, JSON.stringify({
        version: 1,
        preferences: { autoLogin: "always" },
      }));
      const prefs = readGlobalPreferences(globalDir);
      expect(prefs.autoLogin).toBe("always");
      expect(prefs.autoSelectProject).toBe("ask"); // default fill
    });
  });

  describe("readProjectPreferences", () => {
    it("returns empty object when no project file exists", () => {
      const prefs = readProjectPreferences(projectDir);
      expect(prefs).toEqual({});
    });

    it("reads project overrides", () => {
      const overrideDir = path.join(projectDir, ".muggle-ai");
      fs.mkdirSync(overrideDir, { recursive: true });
      fs.writeFileSync(
        path.join(overrideDir, "preferences.json"),
        JSON.stringify({ version: 1, preferences: { defaultExecutionMode: "always" } }),
      );
      const prefs = readProjectPreferences(projectDir);
      expect(prefs.defaultExecutionMode).toBe("always");
    });
  });

  describe("resolvePreferences", () => {
    it("merges global + project, project wins", () => {
      // Write global
      fs.writeFileSync(
        path.join(globalDir, "preferences.json"),
        JSON.stringify({ version: 1, preferences: { autoLogin: "always", verboseOutput: "never" } }),
      );
      // Write project override
      const overrideDir = path.join(projectDir, ".muggle-ai");
      fs.mkdirSync(overrideDir, { recursive: true });
      fs.writeFileSync(
        path.join(overrideDir, "preferences.json"),
        JSON.stringify({ version: 1, preferences: { autoLogin: "never" } }),
      );

      const resolved = resolvePreferences(globalDir, projectDir);
      expect(resolved.autoLogin).toBe("never");       // project wins
      expect(resolved.verboseOutput).toBe("never");   // global kept
      expect(resolved.checkForUpdates).toBe("ask");    // default fill
    });
  });

  describe("writePreferences", () => {
    it("writes global preferences file", () => {
      writePreferences({ autoLogin: "always" }, "global", globalDir, projectDir);
      const raw = JSON.parse(fs.readFileSync(path.join(globalDir, "preferences.json"), "utf-8"));
      expect(raw.version).toBe(1);
      expect(raw.preferences.autoLogin).toBe("always");
    });

    it("writes project preferences file", () => {
      writePreferences({ defaultExecutionMode: "always" }, "project", globalDir, projectDir);
      const overridePath = path.join(projectDir, ".muggle-ai", "preferences.json");
      const raw = JSON.parse(fs.readFileSync(overridePath, "utf-8"));
      expect(raw.preferences.defaultExecutionMode).toBe("always");
    });
  });

  describe("resetPreference", () => {
    it("removes a single key from global file", () => {
      fs.writeFileSync(
        path.join(globalDir, "preferences.json"),
        JSON.stringify({ version: 1, preferences: { autoLogin: "always", verboseOutput: "never" } }),
      );
      resetPreference("autoLogin", "global", globalDir, projectDir);
      const raw = JSON.parse(fs.readFileSync(path.join(globalDir, "preferences.json"), "utf-8"));
      expect(raw.preferences.autoLogin).toBeUndefined();
      expect(raw.preferences.verboseOutput).toBe("never");
    });

    it("resets entire file when no key provided", () => {
      fs.writeFileSync(
        path.join(globalDir, "preferences.json"),
        JSON.stringify({ version: 1, preferences: { autoLogin: "always" } }),
      );
      resetPreference(undefined, "global", globalDir, projectDir);
      const raw = JSON.parse(fs.readFileSync(path.join(globalDir, "preferences.json"), "utf-8"));
      expect(raw.preferences).toEqual({});
    });
  });

  describe("validatePreference", () => {
    it("accepts valid key and value", () => {
      expect(validatePreference("autoLogin", "always")).toBe(true);
      expect(validatePreference("verboseOutput", "never")).toBe(true);
    });

    it("rejects invalid key", () => {
      expect(validatePreference("notAKey", "always")).toBe(false);
    });

    it("rejects invalid value", () => {
      expect(validatePreference("autoLogin", "sometimes")).toBe(false);
    });
  });

  describe("formatPreferencesOneLiner", () => {
    it("formats all preferences into a compact string", () => {
      const result = formatPreferencesOneLiner(DEFAULT_PREFERENCES);
      expect(result).toContain("autoLogin=ask");
      expect(result).toContain("verboseOutput=ask");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/stan/Github/muggle-ai-works && npx vitest run packages/mcps/src/test/preferences.test.ts`
Expected: FAIL — `preferences.js` module not found

- [ ] **Step 3: Implement PreferencesService**

Create `packages/mcps/src/shared/preferences.ts`:

```typescript
/**
 * Preferences service — read, write, merge, validate user preferences.
 *
 * Skills consume preferences via the SessionStart hook (zero tokens).
 * MCP tools import this service directly (zero tokens).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { getDataDir } from "./data-dir.js";
import { getLogger } from "./logger.js";
import {
  PreferenceKey,
  PreferenceValue,
  type IPartialPreferences,
  type IPreferences,
  type IPreferencesFile,
} from "./preferences-types.js";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_FILE_NAME,
  PREFERENCES_PROJECT_DIR_NAME,
  PREFERENCES_VERSION,
} from "./preferences-constants.js";

const logger = getLogger();

/**
 * Check whether the global preferences file exists.
 * @param dataDirOverride - Override data dir for testing.
 */
export function isFirstRun(dataDirOverride?: string): boolean {
  const filePath = path.join(dataDirOverride ?? getDataDir(), PREFERENCES_FILE_NAME);
  return !fs.existsSync(filePath);
}

/**
 * Read a preferences file from disk.
 * Returns empty preferences on any error.
 */
function readPreferencesFile(filePath: string): IPartialPreferences {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as IPreferencesFile;
    return raw.preferences ?? {};
  } catch (error) {
    logger.warn("Failed to read preferences file", {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/**
 * Read global preferences from ~/.muggle-ai/preferences.json.
 * Missing keys are filled with defaults.
 * @param dataDirOverride - Override data dir for testing.
 */
export function readGlobalPreferences(dataDirOverride?: string): IPreferences {
  const filePath = path.join(dataDirOverride ?? getDataDir(), PREFERENCES_FILE_NAME);
  const partial = readPreferencesFile(filePath);
  return { ...DEFAULT_PREFERENCES, ...partial };
}

/**
 * Read per-project preference overrides from {cwd}/.muggle-ai/preferences.json.
 * Returns only the keys explicitly set in the project file.
 * @param cwd - Project root directory.
 */
export function readProjectPreferences(cwd: string): IPartialPreferences {
  const filePath = path.join(cwd, PREFERENCES_PROJECT_DIR_NAME, PREFERENCES_FILE_NAME);
  return readPreferencesFile(filePath);
}

/**
 * Resolve preferences: defaults → global → per-project (last wins).
 * @param dataDirOverride - Override data dir for testing.
 * @param cwd - Project root directory (optional).
 */
export function resolvePreferences(dataDirOverride?: string, cwd?: string): IPreferences {
  const global = readGlobalPreferences(dataDirOverride);
  if (!cwd) {
    return global;
  }
  const project = readProjectPreferences(cwd);
  return { ...global, ...project };
}

/**
 * Write preferences to the appropriate file.
 * @param prefs - Partial preferences to write (merged with existing).
 * @param scope - "global" or "project".
 * @param dataDirOverride - Override data dir for testing.
 * @param cwd - Project root (required when scope is "project").
 */
export function writePreferences(
  prefs: IPartialPreferences,
  scope: "global" | "project",
  dataDirOverride?: string,
  cwd?: string,
): void {
  const dir =
    scope === "project" && cwd
      ? path.join(cwd, PREFERENCES_PROJECT_DIR_NAME)
      : (dataDirOverride ?? getDataDir());

  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, PREFERENCES_FILE_NAME);

  // Merge with existing file contents
  const existing = readPreferencesFile(filePath);
  const merged = { ...existing, ...prefs };

  const file: IPreferencesFile = {
    version: PREFERENCES_VERSION,
    preferences: merged,
  };

  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}

/**
 * Reset a preference key (or the entire file) back to defaults.
 * @param key - Key to reset, or undefined to reset the entire file.
 * @param scope - "global" or "project".
 * @param dataDirOverride - Override data dir for testing.
 * @param cwd - Project root (required when scope is "project").
 */
export function resetPreference(
  key: string | undefined,
  scope: "global" | "project",
  dataDirOverride?: string,
  cwd?: string,
): void {
  const dir =
    scope === "project" && cwd
      ? path.join(cwd, PREFERENCES_PROJECT_DIR_NAME)
      : (dataDirOverride ?? getDataDir());

  const filePath = path.join(dir, PREFERENCES_FILE_NAME);

  if (!fs.existsSync(filePath)) {
    return;
  }

  if (!key) {
    // Reset entire file
    const file: IPreferencesFile = { version: PREFERENCES_VERSION, preferences: {} };
    fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
    return;
  }

  // Remove single key
  const existing = readPreferencesFile(filePath);
  delete existing[key as PreferenceKey];
  const file: IPreferencesFile = { version: PREFERENCES_VERSION, preferences: existing };
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}

/**
 * Validate that a key and value are valid preferences.
 */
export function validatePreference(key: string, value: string): boolean {
  const validKeys = Object.values(PreferenceKey) as string[];
  const validValues = Object.values(PreferenceValue) as string[];
  return validKeys.includes(key) && validValues.includes(value);
}

/**
 * Format resolved preferences as a compact one-liner for session context.
 */
export function formatPreferencesOneLiner(prefs: IPreferences): string {
  return Object.entries(prefs)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/stan/Github/muggle-ai-works && npx vitest run packages/mcps/src/test/preferences.test.ts`
Expected: PASS

- [ ] **Step 5: Export from package index**

Add to `packages/mcps/src/index.ts`:

```typescript
export * from "./shared/preferences-types.js";
export * from "./shared/preferences-constants.js";
export * from "./shared/preferences.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/mcps/src/shared/preferences.ts packages/mcps/src/index.ts packages/mcps/src/test/preferences.test.ts
git commit -m "feat(preferences): add PreferencesService with read/write/merge/validate"
```

---

### Task 3: MCP Tool — `muggle-local-preferences-set`

**Files:**
- Create: `packages/mcps/src/mcp/local/contracts/preferences-schemas.ts`
- Modify: `packages/mcps/src/mcp/local/contracts/index.ts`
- Modify: `packages/mcps/src/mcp/tools/local/tool-registry.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/mcps/src/test/preferences.test.ts`:

```typescript
import { PreferencesSetInputSchema } from "../mcp/local/contracts/preferences-schemas.js";

describe("PreferencesSetInputSchema", () => {
  it("accepts valid input", () => {
    const result = PreferencesSetInputSchema.parse({
      key: "autoLogin",
      value: "always",
    });
    expect(result.key).toBe("autoLogin");
    expect(result.value).toBe("always");
    expect(result.scope).toBe("global"); // default
  });

  it("accepts project scope", () => {
    const result = PreferencesSetInputSchema.parse({
      key: "autoLogin",
      value: "never",
      scope: "project",
      cwd: "/some/path",
    });
    expect(result.scope).toBe("project");
  });

  it("rejects invalid key", () => {
    expect(() =>
      PreferencesSetInputSchema.parse({ key: "badKey", value: "always" }),
    ).toThrow();
  });

  it("rejects invalid value", () => {
    expect(() =>
      PreferencesSetInputSchema.parse({ key: "autoLogin", value: "sometimes" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/stan/Github/muggle-ai-works && npx vitest run packages/mcps/src/test/preferences.test.ts`
Expected: FAIL — schema module not found

- [ ] **Step 3: Create preferences-schemas.ts**

Create `packages/mcps/src/mcp/local/contracts/preferences-schemas.ts`:

```typescript
/**
 * Zod schemas for preferences tools.
 */

import { z } from "zod";

import { PreferenceKey, PreferenceValue } from "../../../shared/preferences-types.js";

const preferenceKeyValues = Object.values(PreferenceKey) as [string, ...string[]];
const preferenceValueValues = Object.values(PreferenceValue) as [string, ...string[]];

/**
 * Input schema for muggle-local-preferences-set.
 */
export const PreferencesSetInputSchema = z.object({
  key: z.enum(preferenceKeyValues).describe("The preference key to set."),
  value: z.enum(preferenceValueValues).describe("The value: always, ask, or never."),
  scope: z.enum(["global", "project"]).default("global").describe("Write to global (~/.muggle-ai/) or project (.muggle-ai/) preferences."),
  cwd: z.string().optional().describe("Project root directory. Required when scope is 'project'."),
});

export type PreferencesSetInput = z.infer<typeof PreferencesSetInputSchema>;
```

- [ ] **Step 4: Export from contracts index**

Add to `packages/mcps/src/mcp/local/contracts/index.ts`:

```typescript
export * from "./preferences-schemas.js";
```

- [ ] **Step 5: Run test to verify schema tests pass**

Run: `cd /Users/stan/Github/muggle-ai-works && npx vitest run packages/mcps/src/test/preferences.test.ts`
Expected: PASS

- [ ] **Step 6: Add the tool to tool-registry.ts**

Add the import at the top of `packages/mcps/src/mcp/tools/local/tool-registry.ts`:

```typescript
import { PreferencesSetInputSchema } from "../../local/contracts/index.js";
import {
  resolvePreferences,
  writePreferences,
  formatPreferencesOneLiner,
} from "../../../shared/preferences.js";
import { PREFERENCES_FILE_NAME } from "../../../shared/preferences-constants.js";
```

Add the tool definition before the `allLocalQaTools` array:

```typescript
// ========================================
// Preferences Tools
// ========================================

const preferencesSetTool: ILocalMcpTool = {
  name: "muggle-local-preferences-set",
  description:
    "Set a Muggle AI user preference. Preferences control automation behavior (auto-login, show browser, suggest test cases, etc.). " +
    "Values: 'always' (proceed without asking), 'ask' (prompt each time), 'never' (skip without asking). " +
    "Scope: 'global' writes to ~/.muggle-ai/preferences.json, 'project' writes to .muggle-ai/preferences.json in the repo root.",
  inputSchema: PreferencesSetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-preferences-set");

    const input = PreferencesSetInputSchema.parse(ctx.input);

    writePreferences(
      { [input.key]: input.value },
      input.scope,
      undefined,
      input.cwd,
    );

    const resolved = resolvePreferences(undefined, input.cwd);
    const oneLiner = formatPreferencesOneLiner(resolved);

    const content = [
      `**${input.key}** set to **${input.value}** (${input.scope}).`,
      "",
      `Preferences file: ~/.muggle-ai/${PREFERENCES_FILE_NAME}`,
      "",
      "Current resolved preferences:",
      `\`${oneLiner}\``,
    ].join("\n");

    return { content: content, isError: false };
  },
};
```

Add to the `allLocalQaTools` array:

```typescript
export const allLocalQaTools: ILocalMcpTool[] = [
  // Status tools
  checkStatusTool,
  listSessionsTool,
  // Run result tools
  runResultListTool,
  runResultGetTool,
  // Test script tools (read-only)
  testScriptListTool,
  testScriptGetTool,
  // Execution tools
  executeTestGenerationTool,
  executeReplayTool,
  cancelExecutionTool,
  // Publishing tools
  publishTestScriptTool,
  // Preferences tools
  preferencesSetTool,
];
```

- [ ] **Step 7: Run all tests**

Run: `cd /Users/stan/Github/muggle-ai-works && npx vitest run packages/mcps/src/test/preferences.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/mcps/src/mcp/local/contracts/preferences-schemas.ts packages/mcps/src/mcp/local/contracts/index.ts packages/mcps/src/mcp/tools/local/tool-registry.ts packages/mcps/src/test/preferences.test.ts
git commit -m "feat(preferences): add muggle-local-preferences-set MCP tool"
```

---

### Task 4: SessionStart Hook — Print Preferences

**Files:**
- Modify: `plugin/scripts/ensure-electron-app.sh`

The preferences context should be injected by the existing SessionStart hook alongside the existing Muggle context, not as a separate hook. This keeps hook count minimal and ensures preferences are always loaded.

- [ ] **Step 1: Add preferences printing to ensure-electron-app.sh**

Add after the `version_check` call (line 65) and before the `context=` line (line 67), insert a new block that reads preferences and builds a one-liner:

```bash
# --- Preferences injection ---
prefs_global_file="${HOME}/.muggle-ai/preferences.json"
prefs_line=""
prefs_file_note=""

if [ -f "$prefs_global_file" ]; then
  # Extract preferences object keys and values into a compact one-liner.
  # Uses node for reliable JSON parsing (already required for muggle).
  prefs_line=$(node -e "
    const fs = require('fs');
    try {
      const g = JSON.parse(fs.readFileSync('${prefs_global_file}', 'utf-8')).preferences || {};
      const defaults = {
        autoLogin:'ask', autoSelectProject:'ask', showElectronBrowser:'ask',
        openTestResultsAfterRun:'ask', defaultExecutionMode:'ask', autoPublishLocalResults:'ask',
        suggestRelatedUseCases:'ask', suggestRelatedTestCases:'ask', autoDetectChanges:'ask',
        postPRVisualWalkthrough:'ask', checkForUpdates:'ask', verboseOutput:'ask'
      };
      const cwd = process.env.CLAUDE_CWD || process.env.CURSOR_CWD || process.cwd();
      const pPath = require('path').join(cwd, '.muggle-ai', 'preferences.json');
      let p = {};
      try { p = JSON.parse(fs.readFileSync(pPath, 'utf-8')).preferences || {}; } catch {}
      const merged = { ...defaults, ...g, ...p };
      const hasProject = Object.keys(p).length > 0;
      const note = hasProject ? ', project overrides active' : '';
      const line = Object.entries(merged).map(([k,v]) => k+'='+v).join(' ');
      console.log('Muggle Preferences (~/.muggle-ai/preferences.json' + note + '):\\n' + line);
    } catch { console.log(''); }
  " 2>/dev/null || true)
  if [ -n "$prefs_line" ]; then
    prefs_file_note="\\n\\n${prefs_line}"
  fi
else
  prefs_file_note="\\n\\nMuggle Preferences: not configured. Run \\\`muggle setup\\\` or tell the agent to set preferences."
fi
```

Then append `${prefs_file_note}` to the end of the `context=` string (before the closing `"` on line 67):

Change the context line to include `${prefs_file_note}` at the end, after `${upgrade_notice}`:

```bash
context="<EXTREMELY_IMPORTANT>...existing content...</EXTREMELY_IMPORTANT>${upgrade_notice}${prefs_file_note}"
```

- [ ] **Step 2: Test the hook locally**

Run: `cd /Users/stan/Github/muggle-ai-works && bash plugin/scripts/ensure-electron-app.sh`
Expected: JSON output with the preferences line included in `additionalContext`

- [ ] **Step 3: Commit**

```bash
git add plugin/scripts/ensure-electron-app.sh
git commit -m "feat(preferences): inject resolved preferences into session context via hook"
```

---

### Task 5: CLI Setup — Write Default Preferences on First Run

**Files:**
- Modify: `src/cli/setup.ts`

- [ ] **Step 1: Add preferences initialization to setupCommand**

At the top of `src/cli/setup.ts`, add imports:

```typescript
import { isFirstRun, writePreferences } from "@muggleai/mcp";
import { DEFAULT_PREFERENCES } from "@muggleai/mcp";
```

At the end of `setupCommand()` (after the electron app install, before the closing `}`), add:

```typescript
  // Initialize default preferences if this is the first run
  if (isFirstRun()) {
    writePreferences(DEFAULT_PREFERENCES, "global");
    console.log(`Default preferences written to ${path.join(getDataDir(), "preferences.json")}`);
    console.log("All preferences default to 'ask'. You can customize them anytime by editing the file or telling the agent to change a preference.");
  }
```

- [ ] **Step 2: Test**

Run: `cd /Users/stan/Github/muggle-ai-works && rm -f ~/.muggle-ai/preferences.json && npx ts-node src/cli/setup.ts`
Expected: See "Default preferences written to ~/.muggle-ai/preferences.json" in output. File exists with all 12 keys set to "ask".

- [ ] **Step 3: Commit**

```bash
git add src/cli/setup.ts
git commit -m "feat(preferences): write default preferences on first muggle setup"
```

---

### Task 6: Skill Updates — Add Preference-Gated Decision Pattern

**Files:**
- Modify: `plugin/skills/muggle-test/SKILL.md`
- Modify: `plugin/skills/muggle-test-feature-local/SKILL.md`
- Modify: `plugin/skills/muggle-test-import/SKILL.md`
- Modify: `plugin/skills/muggle-test-regenerate-missing/SKILL.md`
- Modify: `plugin/skills/muggle-pr-visual-walkthrough/SKILL.md`
- Modify: `plugin/skills/muggle-status/SKILL.md`
- Modify: `plugin/skills/muggle/SKILL.md`

Each skill needs a "Preferences" section that:
1. Explains how to read preferences from the session context
2. Lists which knobs this skill uses
3. Documents the always/ask/never behavior for each knob
4. Includes the "remember this choice?" follow-up pattern

- [ ] **Step 1: Create the shared preference instruction block**

This block will be copy-pasted into each skill (adjusted per skill for which knobs it uses). Here is the template:

```markdown
## Preferences

User preferences are available in the session context (injected at session start). Look for the line starting with `Muggle Preferences` — it contains key=value pairs like `autoLogin=ask showElectronBrowser=always ...`.

If no preferences line is present, treat all preferences as `"ask"`.

When you reach a decision gated by a preference:
- **`always`** → proceed without asking the user
- **`never`** → skip without asking the user  
- **`ask`** → ask the user, then offer: "Want me to remember this choice for future sessions?" If yes, call `muggle-local-preferences-set` with the key, their chosen value, and scope `global`.

This skill uses these preferences:
| Preference | Decision it gates |
|------------|------------------|
| ... | ... |
```

- [ ] **Step 2: Update muggle-test/SKILL.md**

Add the Preferences section after the "UX Guidelines" section. Knobs used:

```markdown
## Preferences

User preferences are available in the session context (injected at session start). Look for the line starting with `Muggle Preferences` — it contains key=value pairs like `autoLogin=ask showElectronBrowser=always ...`.

If no preferences line is present, treat all preferences as `"ask"`.

When you reach a decision gated by a preference:
- **`always`** → proceed without asking the user
- **`never`** → skip without asking the user  
- **`ask`** → ask the user, then offer: "Want me to remember this choice for future sessions?" If yes, call `muggle-local-preferences-set` with the key, their chosen value, and scope `global`.

This skill uses these preferences:
| Preference | Decision it gates |
|------------|------------------|
| `autoLogin` | Reuse saved credentials when auth is required |
| `autoSelectProject` | Reuse last-used Muggle project for this repo |
| `autoDetectChanges` | Scan local git changes and map to affected test cases |
| `defaultExecutionMode` | Default to local or remote test execution |
| `autoPublishLocalResults` | Upload local results to Muggle cloud after run |
| `postPRVisualWalkthrough` | Post visual walkthrough to PR after results are available |
```

- [ ] **Step 3: Update muggle-test-feature-local/SKILL.md**

Knobs used:

```markdown
| Preference | Decision it gates |
|------------|------------------|
| `autoLogin` | Reuse saved credentials when auth is required |
| `autoSelectProject` | Reuse last-used Muggle project for this repo |
| `showElectronBrowser` | Show Electron browser window during local E2E tests |
| `openTestResultsAfterRun` | Open results page on Muggle dashboard after run |
```

- [ ] **Step 4: Update muggle-test-import/SKILL.md**

Knobs used:

```markdown
| Preference | Decision it gates |
|------------|------------------|
| `autoLogin` | Reuse saved credentials when auth is required |
| `autoSelectProject` | Reuse last-used Muggle project for this repo |
| `suggestRelatedUseCases` | Suggest related use cases after import |
| `suggestRelatedTestCases` | Suggest related test cases after import |
```

- [ ] **Step 5: Update muggle-test-regenerate-missing/SKILL.md**

Knobs used:

```markdown
| Preference | Decision it gates |
|------------|------------------|
| `autoLogin` | Reuse saved credentials when auth is required |
| `autoSelectProject` | Reuse last-used Muggle project for this repo |
```

- [ ] **Step 6: Update muggle-pr-visual-walkthrough/SKILL.md**

Knobs used:

```markdown
| Preference | Decision it gates |
|------------|------------------|
| `postPRVisualWalkthrough` | Post visual walkthrough to PR |
```

- [ ] **Step 7: Update muggle-status/SKILL.md**

Knobs used:

```markdown
| Preference | Decision it gates |
|------------|------------------|
| `checkForUpdates` | Check for newer Muggle version |
```

- [ ] **Step 8: Update muggle/SKILL.md (router)**

Knobs used:

```markdown
| Preference | Decision it gates |
|------------|------------------|
| `checkForUpdates` | Check for newer Muggle version |
```

- [ ] **Step 9: Commit**

```bash
git add plugin/skills/muggle-test/SKILL.md plugin/skills/muggle-test-feature-local/SKILL.md plugin/skills/muggle-test-import/SKILL.md plugin/skills/muggle-test-regenerate-missing/SKILL.md plugin/skills/muggle-pr-visual-walkthrough/SKILL.md plugin/skills/muggle-status/SKILL.md plugin/skills/muggle/SKILL.md
git commit -m "feat(preferences): add preference-gated decision pattern to all skills"
```

---

### Task 7: Lint, Build, and Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run linter**

Run: `cd /Users/stan/Github/muggle-ai-works && npx eslint packages/mcps/src/shared/preferences-types.ts packages/mcps/src/shared/preferences-constants.ts packages/mcps/src/shared/preferences.ts packages/mcps/src/mcp/local/contracts/preferences-schemas.ts`
Expected: No errors

- [ ] **Step 2: Run TypeScript type check**

Run: `cd /Users/stan/Github/muggle-ai-works && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/stan/Github/muggle-ai-works && npx vitest run`
Expected: All tests pass (existing + new preference tests)

- [ ] **Step 4: Run build**

Run: `cd /Users/stan/Github/muggle-ai-works && npm run build`
Expected: Clean build

- [ ] **Step 5: Fix any issues and commit**

```bash
git add -A
git commit -m "chore: fix lint/build issues from preferences feature"
```
