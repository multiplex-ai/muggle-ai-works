/** Tests for the last-host cache. */

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
  LAST_HOST_FILE_NAME,
  LAST_HOST_DIR_NAME,
  LAST_HOST_VERSION,
  clearLastHost,
  formatLastHostOneLiner,
  readLastHost,
  writeLastHost,
  type ILastHostFile,
} from "../shared/last-host.js";
import {
  LastHostGetInputSchema,
  LastHostSetInputSchema,
  LastHostClearInputSchema,
} from "../mcp/local/contracts/last-host-schemas.js";

describe("last-host constants", () => {
  it("uses last-host.json as the file name", () => {
    expect(LAST_HOST_FILE_NAME).toBe("last-host.json");
  });

  it("uses .muggle-ai as the dir name (shared with prefs and last-project)", () => {
    expect(LAST_HOST_DIR_NAME).toBe(".muggle-ai");
  });

  it("starts at schema version 1", () => {
    expect(LAST_HOST_VERSION).toBe(1);
  });
});

describe("last-host cache", () => {
  let projectDir: string;
  let otherProjectDir: string;

  const homeFilePath = (): string => path.join(homeDirState.path, LAST_HOST_FILE_NAME);

  const legacyFilePath = (cwd: string): string =>
    path.join(cwd, LAST_HOST_DIR_NAME, LAST_HOST_FILE_NAME);

  const writeLegacyFile = (cwd: string, host: string): void => {
    fs.mkdirSync(path.join(cwd, LAST_HOST_DIR_NAME), { recursive: true });
    const legacy: ILastHostFile = {
      version: LAST_HOST_VERSION,
      lastHost: { host: host, savedAt: "2020-01-01T00:00:00.000Z" },
    };
    fs.writeFileSync(legacyFilePath(cwd), JSON.stringify(legacy), "utf-8");
  };

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-last-host-test-"));
    otherProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-last-host-other-"));
    homeDirState.path = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-last-host-home-"));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(otherProjectDir, { recursive: true, force: true });
    fs.rmSync(homeDirState.path, { recursive: true, force: true });
  });

  describe("readLastHost", () => {
    it("returns null when no cache exists", () => {
      expect(readLastHost(projectDir)).toBeNull();
    });

    it("returns the cached host when written", () => {
      writeLastHost(projectDir, "http://localhost:3000");
      const cached = readLastHost(projectDir);
      expect(cached).not.toBeNull();
      expect(cached?.host).toBe("http://localhost:3000");
      expect(cached?.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("returns null for an unparseable home file", () => {
      fs.writeFileSync(homeFilePath(), "{ not json", "utf-8");
      expect(readLastHost(projectDir)).toBeNull();
    });

    it("migrates a superseded in-project cache into the home file", () => {
      writeLegacyFile(projectDir, "http://localhost:4200");

      expect(readLastHost(projectDir)?.host).toBe("http://localhost:4200");

      const stored = JSON.parse(fs.readFileSync(homeFilePath(), "utf-8"));
      expect(stored.entries[path.resolve(projectDir)].host).toBe("http://localhost:4200");
    });

    it("prefers the home entry over a superseded in-project cache", () => {
      writeLegacyFile(projectDir, "http://localhost:4200");
      writeLastHost(projectDir, "http://localhost:3000");
      expect(readLastHost(projectDir)?.host).toBe("http://localhost:3000");
    });
  });

  describe("writeLastHost", () => {
    it("writes nothing inside the project directory", () => {
      writeLastHost(projectDir, "http://localhost:3000");
      expect(fs.existsSync(path.join(projectDir, LAST_HOST_DIR_NAME))).toBe(false);
    });

    it("creates the home directory if missing", () => {
      fs.rmSync(homeDirState.path, { recursive: true, force: true });
      writeLastHost(projectDir, "http://localhost:3000");
      expect(fs.existsSync(homeFilePath())).toBe(true);
    });

    it("writes a versioned map keyed by absolute working directory", () => {
      writeLastHost(projectDir, "http://localhost:3000");
      const stored = JSON.parse(fs.readFileSync(homeFilePath(), "utf-8"));
      expect(stored.version).toBe(1);
      expect(stored.entries[path.resolve(projectDir)].host).toBe("http://localhost:3000");
    });

    it("overwrites the entry for the same working directory", () => {
      writeLastHost(projectDir, "http://localhost:3000");
      writeLastHost(projectDir, "http://localhost:5173");
      expect(readLastHost(projectDir)?.host).toBe("http://localhost:5173");
    });

    it("keeps entries for different working directories apart", () => {
      writeLastHost(projectDir, "http://localhost:3000");
      writeLastHost(otherProjectDir, "http://localhost:5173");
      expect(readLastHost(projectDir)?.host).toBe("http://localhost:3000");
      expect(readLastHost(otherProjectDir)?.host).toBe("http://localhost:5173");
    });
  });

  describe("clearLastHost", () => {
    it("removes the cached entry", () => {
      writeLastHost(projectDir, "http://localhost:3000");
      clearLastHost(projectDir);
      expect(readLastHost(projectDir)).toBeNull();
    });

    it("removes the superseded in-project file so it cannot resurrect the entry", () => {
      writeLegacyFile(projectDir, "http://localhost:4200");
      writeLastHost(projectDir, "http://localhost:3000");

      clearLastHost(projectDir);

      expect(fs.existsSync(legacyFilePath(projectDir))).toBe(false);
      expect(readLastHost(projectDir)).toBeNull();
    });

    it("leaves other working directories untouched", () => {
      writeLastHost(projectDir, "http://localhost:3000");
      writeLastHost(otherProjectDir, "http://localhost:5173");
      clearLastHost(projectDir);
      expect(readLastHost(otherProjectDir)?.host).toBe("http://localhost:5173");
    });

    it("is a no-op when no cache exists", () => {
      expect(() => clearLastHost(projectDir)).not.toThrow();
    });
  });

  describe("formatLastHostOneLiner", () => {
    it("returns empty string when no cache", () => {
      expect(formatLastHostOneLiner(projectDir)).toBe("");
    });

    it("formats a one-liner suitable for session context", () => {
      writeLastHost(projectDir, "http://localhost:3000");
      expect(formatLastHostOneLiner(projectDir)).toBe(
        "Muggle Test Last Host: http://localhost:3000",
      );
    });
  });
});

describe("LastHostGetInputSchema", () => {
  it("requires cwd", () => {
    expect(() => LastHostGetInputSchema.parse({})).toThrow();
  });

  it("accepts a valid input", () => {
    expect(LastHostGetInputSchema.parse({ cwd: "/repo" }).cwd).toBe("/repo");
  });
});

describe("LastHostSetInputSchema", () => {
  it("requires cwd and host", () => {
    expect(() => LastHostSetInputSchema.parse({ cwd: "/x" })).toThrow();
    expect(() => LastHostSetInputSchema.parse({ host: "u" })).toThrow();
  });

  it("rejects empty host", () => {
    expect(() => LastHostSetInputSchema.parse({ cwd: "/x", host: "" })).toThrow();
  });

  it("accepts a valid input", () => {
    const parsed = LastHostSetInputSchema.parse({
      cwd: "/repo",
      host: "http://localhost:3000",
    });
    expect(parsed.host).toBe("http://localhost:3000");
  });
});

describe("LastHostClearInputSchema", () => {
  it("requires cwd", () => {
    expect(() => LastHostClearInputSchema.parse({})).toThrow();
  });

  it("accepts a valid input", () => {
    expect(LastHostClearInputSchema.parse({ cwd: "/repo" }).cwd).toBe("/repo");
  });
});
