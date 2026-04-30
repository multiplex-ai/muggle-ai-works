/**
 * Tests for the per-repo last-project cache.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  LAST_PROJECT_FILE_NAME,
  LAST_PROJECT_DIR_NAME,
  LAST_PROJECT_VERSION,
  clearLastProject,
  formatLastProjectOneLiner,
  readLastProject,
  writeLastProject,
} from "../shared/last-project.js";
import {
  LastProjectGetInputSchema,
  LastProjectSetInputSchema,
  LastProjectClearInputSchema,
} from "../mcp/local/contracts/last-project-schemas.js";

describe("last-project constants", () => {
  it("uses last-project.json as the file name", () => {
    expect(LAST_PROJECT_FILE_NAME).toBe("last-project.json");
  });

  it("uses .muggle-ai as the dir name (shared with prefs)", () => {
    expect(LAST_PROJECT_DIR_NAME).toBe(".muggle-ai");
  });

  it("starts at schema version 1", () => {
    expect(LAST_PROJECT_VERSION).toBe(1);
  });
});

describe("last-project cache", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-last-project-test-"));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  describe("readLastProject", () => {
    it("returns null when no cache exists", () => {
      expect(readLastProject(projectDir)).toBeNull();
    });

    it("returns the cached project when written", () => {
      writeLastProject(projectDir, {
        projectId: "proj-123",
        projectUrl: "https://app.example.com",
        projectName: "Example",
      });
      const cached = readLastProject(projectDir);
      expect(cached).not.toBeNull();
      expect(cached?.projectId).toBe("proj-123");
      expect(cached?.projectUrl).toBe("https://app.example.com");
      expect(cached?.projectName).toBe("Example");
      expect(cached?.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("writeLastProject", () => {
    it("creates the .muggle-ai directory if missing", () => {
      writeLastProject(projectDir, {
        projectId: "p1",
        projectUrl: "https://x.com",
        projectName: "X",
      });
      expect(fs.existsSync(path.join(projectDir, LAST_PROJECT_DIR_NAME))).toBe(true);
    });

    it("writes a versioned file shape", () => {
      writeLastProject(projectDir, {
        projectId: "p1",
        projectUrl: "https://x.com",
        projectName: "X",
      });
      const filePath = path.join(projectDir, LAST_PROJECT_DIR_NAME, LAST_PROJECT_FILE_NAME);
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(raw.version).toBe(1);
      expect(raw.lastProject.projectId).toBe("p1");
    });

    it("overwrites an existing cache file", () => {
      writeLastProject(projectDir, { projectId: "p1", projectUrl: "u1", projectName: "n1" });
      writeLastProject(projectDir, { projectId: "p2", projectUrl: "u2", projectName: "n2" });
      const cached = readLastProject(projectDir);
      expect(cached?.projectId).toBe("p2");
    });
  });

  describe("clearLastProject", () => {
    it("removes the cache file", () => {
      writeLastProject(projectDir, { projectId: "p1", projectUrl: "u", projectName: "n" });
      clearLastProject(projectDir);
      expect(readLastProject(projectDir)).toBeNull();
    });

    it("is a no-op when no cache exists", () => {
      expect(() => clearLastProject(projectDir)).not.toThrow();
    });
  });

  describe("formatLastProjectOneLiner", () => {
    it("returns empty string when no cache", () => {
      expect(formatLastProjectOneLiner(projectDir)).toBe("");
    });

    it("formats a one-liner suitable for session context", () => {
      writeLastProject(projectDir, {
        projectId: "proj-abc",
        projectUrl: "https://app.example.com",
        projectName: "Example App",
      });
      const line = formatLastProjectOneLiner(projectDir);
      expect(line).toBe(
        'Muggle Last Project: id=proj-abc url=https://app.example.com name="Example App"',
      );
    });

    it("escapes quotes in project names", () => {
      writeLastProject(projectDir, {
        projectId: "p1",
        projectUrl: "https://x.com",
        projectName: 'Has "quotes"',
      });
      const line = formatLastProjectOneLiner(projectDir);
      expect(line).toContain('name="Has \\"quotes\\""');
    });
  });
});

describe("LastProjectGetInputSchema", () => {
  it("requires cwd", () => {
    expect(() => LastProjectGetInputSchema.parse({})).toThrow();
  });

  it("accepts a valid input", () => {
    const r = LastProjectGetInputSchema.parse({ cwd: "/some/repo" });
    expect(r.cwd).toBe("/some/repo");
  });
});

describe("LastProjectSetInputSchema", () => {
  it("requires all fields", () => {
    expect(() => LastProjectSetInputSchema.parse({ cwd: "/x" })).toThrow();
    expect(() =>
      LastProjectSetInputSchema.parse({
        cwd: "/x",
        projectId: "p1",
        projectUrl: "u",
      }),
    ).toThrow();
  });

  it("accepts a valid input", () => {
    const r = LastProjectSetInputSchema.parse({
      cwd: "/repo",
      projectId: "p1",
      projectUrl: "https://x.com",
      projectName: "n",
    });
    expect(r.projectId).toBe("p1");
  });

  it("rejects empty strings", () => {
    expect(() =>
      LastProjectSetInputSchema.parse({
        cwd: "/repo",
        projectId: "",
        projectUrl: "u",
        projectName: "n",
      }),
    ).toThrow();
  });
});

describe("LastProjectClearInputSchema", () => {
  it("requires cwd", () => {
    expect(() => LastProjectClearInputSchema.parse({})).toThrow();
  });

  it("accepts a valid input", () => {
    const r = LastProjectClearInputSchema.parse({ cwd: "/some/repo" });
    expect(r.cwd).toBe("/some/repo");
  });
});
