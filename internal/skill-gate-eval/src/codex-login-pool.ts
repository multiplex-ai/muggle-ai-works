/**
 * Mid-run rotation through resolve-codex-auth's pool of ChatGPT-subscription
 * logins. A login that hits its usage limit gets an exhausted marker in the
 * pool directory, which every eval process of the job reads, so it is tried
 * once; the Codex home's auth.json is swapped to the lowest login without one.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  CODEX_AUTH_POOL_ENV,
  CODEX_EXHAUSTED_LOGIN_SUFFIX,
  CODEX_INSTALLED_LOGIN_FILENAME,
} from "./constants.js";
import type { CodexLoginPoolLike, LoginRotationOptions } from "./types.js";
import { isUsageLimitError } from "./usage-limit.js";

const POOL_LOGIN_FILENAME = /^(\d+)\.json$/;

/** The pool of subscription logins one Codex home rotates through. */
export class CodexLoginPool implements CodexLoginPoolLike {
  private readonly loginIndexes: number[];

  constructor(
    private readonly poolDir: string,
    private readonly codexHome: string,
  ) {
    this.loginIndexes = fs
      .readdirSync(poolDir)
      .flatMap((filename) => {
        const match = POOL_LOGIN_FILENAME.exec(filename);
        return match ? [Number(match[1])] : [];
      })
      .sort((left, right) => left - right);
  }

  /**
   * The pool `$CODEX_AUTH_POOL_DIR` names, for `codexHome`.
   *
   * @returns null when the variable is unset (API-key auth) or names an empty or missing directory.
   */
  static fromEnv(codexHome: string, env: NodeJS.ProcessEnv = process.env): CodexLoginPool | null {
    const poolDir = env[CODEX_AUTH_POOL_ENV];
    if (!poolDir || !fs.existsSync(poolDir)) return null;
    const pool = new CodexLoginPool(poolDir, codexHome);
    return pool.loginIndexes.length > 0 ? pool : null;
  }

  activeLoginIndex(): number | null {
    return this.loginIndexes.find((loginIndex) => !this.isExhausted(loginIndex)) ?? null;
  }

  /**
   * Put the active login in the Codex home, unless it already holds it — a process started after
   * an earlier one exhausted login 0 would otherwise begin on the login seed-home.sh copied.
   *
   * @returns the installed login's index, or null when every login is exhausted.
   */
  installActiveLogin(): number | null {
    const activeLoginIndex = this.activeLoginIndex();
    if (activeLoginIndex === null) return null;
    if (this.installedLoginIndex() !== activeLoginIndex) {
      const authPath = path.join(this.codexHome, "auth.json");
      fs.mkdirSync(this.codexHome, { recursive: true });
      fs.copyFileSync(path.join(this.poolDir, `${activeLoginIndex}.json`), authPath);
      fs.chmodSync(authPath, 0o600);
      fs.writeFileSync(path.join(this.codexHome, CODEX_INSTALLED_LOGIN_FILENAME), String(activeLoginIndex));
    }
    return activeLoginIndex;
  }

  rotateAfterUsageLimit(exhaustedLoginIndex: number): boolean {
    fs.writeFileSync(this.exhaustedMarkerPath(exhaustedLoginIndex), "");
    return this.installActiveLogin() !== null;
  }

  private isExhausted(loginIndex: number): boolean {
    return fs.existsSync(this.exhaustedMarkerPath(loginIndex));
  }

  private exhaustedMarkerPath(loginIndex: number): string {
    return path.join(this.poolDir, `${loginIndex}${CODEX_EXHAUSTED_LOGIN_SUFFIX}`);
  }

  private installedLoginIndex(): number {
    const markerPath = path.join(this.codexHome, CODEX_INSTALLED_LOGIN_FILENAME);
    return fs.existsSync(markerPath) ? Number(fs.readFileSync(markerPath, "utf8").trim()) : 0;
  }
}

/**
 * Run `runRep`, and when it stops on a usage limit, swap the Codex home to the pool's next login
 * and run it again; the retry is the same rep, not another one. Reps already in flight on a login
 * that runs out each mark the same login, so it is rotated past once.
 *
 * @throws the usage-limit error once every pool login is exhausted, and any other error as is.
 */
export async function withLoginRotation<T>(runRep: () => Promise<T>, options: LoginRotationOptions): Promise<T> {
  for (;;) {
    const startingLoginIndex = options.pool?.activeLoginIndex() ?? null;
    try {
      return await runRep();
    } catch (error) {
      if (!options.pool || startingLoginIndex === null || !isUsageLimitError(error)) throw error;
      if (!options.pool.rotateAfterUsageLimit(startingLoginIndex)) throw error;
      options.onRotate?.(startingLoginIndex, options.pool.activeLoginIndex() as number, error);
    }
  }
}
