import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { CodexLoginPool, withLoginRotation } from "./codex-login-pool.js";
import { CODEX_AUTH_POOL_ENV } from "./constants.js";

const USAGE_LIMIT_MESSAGE = "codex exec exited 1: You've hit your usage limit. Upgrade to Pro to keep going.";

function loginJson(accountId: string): string {
  return JSON.stringify({ auth_mode: "chatgpt", tokens: { refresh_token: `refresh-${accountId}`, account_id: accountId } });
}

/** A pool of `loginCount` logins and a Codex home seeded with login 0, as seed-home.sh leaves it. */
function seededPool(loginCount: number): { poolDir: string; codexHome: string } {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-login-pool-"));
  const poolDir = path.join(workDir, "pool");
  const codexHome = path.join(workDir, "home");
  fs.mkdirSync(poolDir);
  fs.mkdirSync(codexHome);
  for (let loginIndex = 0; loginIndex < loginCount; loginIndex++) {
    fs.writeFileSync(path.join(poolDir, `${loginIndex}.json`), loginJson(`acct-${loginIndex}`));
  }
  fs.copyFileSync(path.join(poolDir, "0.json"), path.join(codexHome, "auth.json"));
  return { poolDir: poolDir, codexHome: codexHome };
}

function installedAccount(codexHome: string): string {
  return JSON.parse(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8")).tokens.account_id;
}

describe("CodexLoginPool", () => {
  it("is absent without a pool directory", () => {
    expect(CodexLoginPool.fromEnv("/unused", {})).toBeNull();
  });

  it("swaps the home to the next login and skips exhausted ones from then on", () => {
    const { poolDir, codexHome } = seededPool(3);
    const pool = CodexLoginPool.fromEnv(codexHome, { [CODEX_AUTH_POOL_ENV]: poolDir }) as CodexLoginPool;
    expect(pool.activeLoginIndex()).toBe(0);
    expect(pool.rotateAfterUsageLimit(0)).toBe(true);
    expect(pool.activeLoginIndex()).toBe(1);
    expect(installedAccount(codexHome)).toBe("acct-1");
  });

  it("starts a later process on the first unexhausted login", () => {
    const { poolDir, codexHome } = seededPool(2);
    new CodexLoginPool(poolDir, codexHome).rotateAfterUsageLimit(0);
    const nextGateHome = path.join(path.dirname(codexHome), "next-gate");
    fs.mkdirSync(nextGateHome);
    fs.copyFileSync(path.join(poolDir, "0.json"), path.join(nextGateHome, "auth.json"));
    expect(new CodexLoginPool(poolDir, nextGateHome).installActiveLogin()).toBe(1);
    expect(installedAccount(nextGateHome)).toBe("acct-1");
  });

  it("reports no usable login once all are exhausted", () => {
    const { poolDir, codexHome } = seededPool(2);
    const pool = new CodexLoginPool(poolDir, codexHome);
    expect(pool.rotateAfterUsageLimit(0)).toBe(true);
    expect(pool.rotateAfterUsageLimit(1)).toBe(false);
    expect(pool.activeLoginIndex()).toBeNull();
  });
});

describe("withLoginRotation", () => {
  it("retries a usage-limited rep on the next login instead of failing it", async () => {
    const { poolDir, codexHome } = seededPool(2);
    const pool = new CodexLoginPool(poolDir, codexHome);
    const accountsTried: string[] = [];
    const rotations: Array<[number, number]> = [];
    const verdict = await withLoginRotation(
      async () => {
        const account = installedAccount(codexHome);
        accountsTried.push(account);
        if (account === "acct-0") throw new Error(USAGE_LIMIT_MESSAGE);
        return "judged";
      },
      { pool: pool, onRotate: (exhaustedLoginIndex, nextLoginIndex) => rotations.push([exhaustedLoginIndex, nextLoginIndex]) },
    );
    expect(verdict).toBe("judged");
    expect(accountsTried).toEqual(["acct-0", "acct-1"]);
    expect(rotations).toEqual([[0, 1]]);
  });

  it("rotates past a login once when parallel reps on it all run out", async () => {
    const { poolDir, codexHome } = seededPool(3);
    const pool = new CodexLoginPool(poolDir, codexHome);
    let releaseFirstAttempts: () => void = () => undefined;
    const firstAttemptsStarted = new Promise<void>((resolve) => (releaseFirstAttempts = resolve));
    let startedOnLoginZero = 0;
    const runParallelRep = (): Promise<string> =>
      withLoginRotation(
        async () => {
          if (installedAccount(codexHome) !== "acct-0") return installedAccount(codexHome);
          startedOnLoginZero++;
          if (startedOnLoginZero === 2) releaseFirstAttempts();
          await firstAttemptsStarted;
          throw new Error(USAGE_LIMIT_MESSAGE);
        },
        { pool: pool },
      );
    expect(await Promise.all([runParallelRep(), runParallelRep()])).toEqual(["acct-1", "acct-1"]);
    expect(pool.activeLoginIndex()).toBe(1);
  });

  it("gives up with the usage-limit error once the pool is exhausted", async () => {
    const { poolDir, codexHome } = seededPool(2);
    const pool = new CodexLoginPool(poolDir, codexHome);
    let attempts = 0;
    await expect(
      withLoginRotation(
        async () => {
          attempts++;
          throw new Error(USAGE_LIMIT_MESSAGE);
        },
        { pool: pool },
      ),
    ).rejects.toThrow("hit your usage limit");
    expect(attempts).toBe(2);
  });

  it("passes other errors through without rotating", async () => {
    const { poolDir, codexHome } = seededPool(2);
    const pool = new CodexLoginPool(poolDir, codexHome);
    await expect(
      withLoginRotation(() => Promise.reject(new Error("transport closed")), { pool: pool }),
    ).rejects.toThrow("transport closed");
    expect(pool.activeLoginIndex()).toBe(0);
  });

  it("leaves a usage limit as is without a pool", async () => {
    await expect(
      withLoginRotation(() => Promise.reject(new Error(USAGE_LIMIT_MESSAGE)), { pool: null }),
    ).rejects.toThrow("hit your usage limit");
  });
});
