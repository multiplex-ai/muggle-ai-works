/** Tests for the last-project cache. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const homeDirState = vi.hoisted(() => ({ path: "" }));

vi.mock("../shared/data-dir.js", () => ({
  getDataDir: () => homeDirState.path,
}));

vi.mock("../shared/logger.js", () => {
  const noop = (): undefined => undefined;
  const silentLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: () => silentLogger,
  };
  return {
    getLogger: () => silentLogger,
    createChildLogger: () => silentLogger,
    resetLogger: noop,
  };
});

import {
  LAST_PROJECT_FILE_NAME,
  LAST_PROJECT_DIR_NAME,
  LAST_PROJECT_VERSION,
  clearLastProject,
  formatLastProjectOneLiner,
  readLastProject,
  writeLastProject,
  type ILastProjectFile,
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
  let otherProjectDir: string;

  const homeFilePath = (): string => path.join(homeDirState.path, LAST_PROJECT_FILE_NAME);

  const legacyFilePath = (cwd: string): string =>
    path.join(cwd, LAST_PROJECT_DIR_NAME, LAST_PROJECT_FILE_NAME);

  const writeLegacyFile = (cwd: string, projectId: string): void => {
    fs.mkdirSync(path.join(cwd, LAST_PROJECT_DIR_NAME), { recursive: true });
    const legacy: ILastProjectFile = {
      version: LAST_PROJECT_VERSION,
      lastProject: {
        projectId: projectId,
        projectUrl: "https://legacy.example.com",
        projectName: "Legacy",
        savedAt: "2020-01-01T00:00:00.000Z",
      },
    };
    fs.writeFileSync(legacyFilePath(cwd), JSON.stringify(legacy), "utf-8");
  };

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-last-project-test-"));
    otherProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-last-project-other-"));
    homeDirState.path = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-last-project-home-"));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(otherProjectDir, { recursive: true, force: true });
    fs.rmSync(homeDirState.path, { recursive: true, force: true });
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

    it("returns null for an unparseable home file", () => {
      fs.writeFileSync(homeFilePath(), "{ not json", "utf-8");
      expect(readLastProject(projectDir)).toBeNull();
    });

    it("migrates a superseded in-project cache into the home file", () => {
      writeLegacyFile(projectDir, "legacy-1");

      expect(readLastProject(projectDir)?.projectId).toBe("legacy-1");

      const stored = JSON.parse(fs.readFileSync(homeFilePath(), "utf-8"));
      expect(stored.entries[path.resolve(projectDir)].projectId).toBe("legacy-1");
    });

    it("prefers the home entry over a superseded in-project cache", () => {
      writeLegacyFile(projectDir, "legacy-1");
      writeLastProject(projectDir, {
        projectId: "p1",
        projectUrl: "https://x.com",
        projectName: "X",
      });
      expect(readLastProject(projectDir)?.projectId).toBe("p1");
    });
  });

  describe("writeLastProject", () => {
    it("writes nothing inside the project directory", () => {
      writeLastProject(projectDir, {
        projectId: "p1",
        projectUrl: "https://x.com",
        projectName: "X",
      });
      expect(fs.existsSync(path.join(projectDir, LAST_PROJECT_DIR_NAME))).toBe(false);
    });

    it("creates the home directory if missing", () => {
      fs.rmSync(homeDirState.path, { recursive: true, force: true });
      writeLastProject(projectDir, {
        projectId: "p1",
        projectUrl: "https://x.com",
        projectName: "X",
      });
      expect(fs.existsSync(homeFilePath())).toBe(true);
    });

    it("writes a versioned map keyed by absolute working directory", () => {
      writeLastProject(projectDir, {
        projectId: "p1",
        projectUrl: "https://x.com",
        projectName: "X",
      });
      const stored = JSON.parse(fs.readFileSync(homeFilePath(), "utf-8"));
      expect(stored.version).toBe(1);
      expect(stored.entries[path.resolve(projectDir)].projectId).toBe("p1");
    });

    it("overwrites the entry for the same working directory", () => {
      writeLastProject(projectDir, { projectId: "p1", projectUrl: "u1", projectName: "n1" });
      writeLastProject(projectDir, { projectId: "p2", projectUrl: "u2", projectName: "n2" });
      expect(readLastProject(projectDir)?.projectId).toBe("p2");
    });

    it("keeps entries for different working directories apart", () => {
      writeLastProject(projectDir, { projectId: "p1", projectUrl: "u1", projectName: "n1" });
      writeLastProject(otherProjectDir, {
        projectId: "p2",
        projectUrl: "u2",
        projectName: "n2",
      });
      expect(readLastProject(projectDir)?.projectId).toBe("p1");
      expect(readLastProject(otherProjectDir)?.projectId).toBe("p2");
    });
  });

  describe("clearLastProject", () => {
    it("removes the cached entry", () => {
      writeLastProject(projectDir, { projectId: "p1", projectUrl: "u", projectName: "n" });
      clearLastProject(projectDir);
      expect(readLastProject(projectDir)).toBeNull();
    });

    it("removes the superseded in-project file so it cannot resurrect the entry", () => {
      writeLegacyFile(projectDir, "legacy-1");
      writeLastProject(projectDir, { projectId: "p1", projectUrl: "u", projectName: "n" });

      clearLastProject(projectDir);

      expect(fs.existsSync(legacyFilePath(projectDir))).toBe(false);
      expect(readLastProject(projectDir)).toBeNull();
    });

    it("leaves other working directories untouched", () => {
      writeLastProject(projectDir, { projectId: "p1", projectUrl: "u1", projectName: "n1" });
      writeLastProject(otherProjectDir, {
        projectId: "p2",
        projectUrl: "u2",
        projectName: "n2",
      });
      clearLastProject(projectDir);
      expect(readLastProject(otherProjectDir)?.projectId).toBe("p2");
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
        'Muggle Test Last Project: id=proj-abc url=https://app.example.com name="Example App"',
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
    const parsed = LastProjectGetInputSchema.parse({ cwd: "/some/repo" });
    expect(parsed.cwd).toBe("/some/repo");
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
    const parsed = LastProjectSetInputSchema.parse({
      cwd: "/repo",
      projectId: "p1",
      projectUrl: "https://x.com",
      projectName: "n",
    });
    expect(parsed.projectId).toBe("p1");
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
    const parsed = LastProjectClearInputSchema.parse({ cwd: "/some/repo" });
    expect(parsed.cwd).toBe("/some/repo");
  });
});
