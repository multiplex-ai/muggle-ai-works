import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "fs";
import { hostname, tmpdir } from "os";
import { join } from "path";
import { withFileLock, isProcessAlive } from "../../guardrails/store/fileLock.js";
import { UNRECORDED_LOCK_HOLDER_GRACE_MS } from "../../guardrails/constants.js";

const lockPath = (): string => join(mkdtempSync(join(tmpdir(), "gr-lock-")), "x.lock");

// A pid high enough that no live process owns it, used to stand in for a holder
// that died without releasing.
const DEAD_PID = 0x7ffffffe;

const holderFile = (path: string, pid: number, host: string): void =>
  writeFileSync(path, JSON.stringify({ pid: pid, host: host, acquiredAt: new Date().toISOString() }));

describe("withFileLock", () => {
  it("runs the body and releases the lock", () => {
    const path = lockPath();
    expect(withFileLock(path, 50, () => "ran")).toBe("ran");
    expect(existsSync(path)).toBe(false);
  });

  it("releases the lock when the body throws", () => {
    const path = lockPath();
    expect(() =>
      withFileLock(path, 50, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(existsSync(path)).toBe(false);
  });

  it("gives up when a live holder owns the lock", () => {
    const path = lockPath();
    holderFile(path, process.pid, hostname());
    expect(withFileLock(path, 30, () => "ran")).toBeUndefined();
  });

  // A crashed holder must not wedge the lock forever, and death is the only
  // signal that breaks it — a slow holder is still a valid holder.
  it("breaks a lock whose holder is dead", () => {
    const path = lockPath();
    holderFile(path, DEAD_PID, hostname());
    expect(withFileLock(path, 50, () => "ran")).toBe("ran");
  });

  it("does not break a lock held on another machine", () => {
    const path = lockPath();
    holderFile(path, DEAD_PID, "elsewhere");
    expect(withFileLock(path, 30, () => "ran")).toBeUndefined();
  });

  // A hook killed between creating the lock and recording itself leaves an
  // empty file with no pid to probe; left alone it blocks every writer for good.
  it("breaks a lock that names no holder once it is past the grace", () => {
    const path = lockPath();
    writeFileSync(path, "");
    const pastGrace = new Date(Date.now() - UNRECORDED_LOCK_HOLDER_GRACE_MS - 1_000);
    utimesSync(path, pastGrace, pastGrace);
    expect(withFileLock(path, 50, () => "ran")).toBe("ran");
  });

  // Its holder may be between creating the file and recording itself.
  it("keeps a fresh lock that names no holder", () => {
    const path = lockPath();
    writeFileSync(path, "");
    expect(withFileLock(path, 30, () => "ran")).toBeUndefined();
  });

  it("records the holder so a later waiter can judge liveness", () => {
    const path = lockPath();
    const recorded = withFileLock(path, 50, () =>
      JSON.parse(readFileSync(path, "utf-8")) as { pid: number; host: string; acquiredAt: string },
    );
    expect(recorded).toEqual({ pid: process.pid, host: hostname(), acquiredAt: expect.any(String) });
  });
});

describe("isProcessAlive", () => {
  it("sees this process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("does not see an unused pid", () => {
    expect(isProcessAlive(DEAD_PID)).toBe(false);
  });
});
