/** Tests for the per-repo last-host cache. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  LAST_HOST_FILE_NAME,
  LAST_HOST_DIR_NAME,
  LAST_HOST_VERSION,
  clearLastHost,
  formatLastHostOneLiner,
  readLastHost,
  writeLastHost,
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

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-last-host-test-"));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
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
  });

  describe("writeLastHost", () => {
    it("creates the .muggle-ai directory if missing", () => {
      writeLastHost(projectDir, "http://localhost:3000");
      expect(fs.existsSync(path.join(projectDir, LAST_HOST_DIR_NAME))).toBe(true);
    });

    it("writes a versioned file shape", () => {
      writeLastHost(projectDir, "http://localhost:3000");
      const filePath = path.join(projectDir, LAST_HOST_DIR_NAME, LAST_HOST_FILE_NAME);
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(raw.version).toBe(1);
      expect(raw.lastHost.host).toBe("http://localhost:3000");
    });

    it("overwrites an existing cache file", () => {
      writeLastHost(projectDir, "http://localhost:3000");
      writeLastHost(projectDir, "http://localhost:5173");
      expect(readLastHost(projectDir)?.host).toBe("http://localhost:5173");
    });
  });

  describe("clearLastHost", () => {
    it("removes the cache file", () => {
      writeLastHost(projectDir, "http://localhost:3000");
      clearLastHost(projectDir);
      expect(readLastHost(projectDir)).toBeNull();
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
    const r = LastHostSetInputSchema.parse({ cwd: "/repo", host: "http://localhost:3000" });
    expect(r.host).toBe("http://localhost:3000");
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
