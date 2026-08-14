/**
 * Behavioral coverage for the watch loop's wake conditions.
 *
 * These exist because the loop used to be re-derived from prose on every arm,
 * and derivations silently disagreed: of four slots on one machine, two woke on
 * a branch falling behind its base and two did not. The two that did not left
 * their PRs permanently unmergeable — on a base requiring up-to-date heads —
 * under watchers that reported themselves healthy. Nothing failed; a condition
 * was simply absent. Pinning each wake here is what makes absence loud.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toBash = (p: string) => p.replace(/\\/g, "/");

const scriptPath = toBash(
  fileURLToPath(new URL("../../../plugin/scripts/pr-watch-events.sh", import.meta.url)),
);

let hasBash = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
} catch {
  // bash unavailable — the suite below skips
}

/** Runs one wake function and returns whatever it emitted ("" means stayed quiet). */
function wake(call: string): string {
  try {
    return execFileSync("bash", ["-c", `source "$SCRIPT"; ${call}`], {
      env: { ...process.env, SCRIPT: scriptPath },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Splits a state line and returns the fields. Deliberately not trimmed — a
 * trailing empty field is exactly what a trimming helper would hide.
 */
function splitState(line: string): string[] {
  const stdout = execFileSync("bash", ["-c", `source "$SCRIPT"; watch_split_state "$LINE"`], {
    env: { ...process.env, SCRIPT: scriptPath, LINE: line },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return stdout.split("\n").slice(0, -1);
}

describe.skipIf(!hasBash)("watch_split_state", () => {
  it("preserves an empty field instead of collapsing it", () => {
    // `IFS=$'\t' read` returns ["a","b"] here: tab is IFS whitespace, so the two
    // adjacent tabs collapse into one delimiter and "b" shifts into slot 1.
    expect(splitState("a\t\tb")).toEqual(["a", "", "b"]);
  });

  it("keeps every later field in place when the thread list is empty", () => {
    // The production shape, with no unresolved thread. Field 6 is the thread
    // list; the shift used to put pending_checks (2) there and fire a thread
    // wake for a PR with no threads, while the digest landed in failed_checks.
    const fields = splitState(
      ["OPEN", "headsha", "basesha", "MERGEABLE", "0", "0", "", "2", "1", "build:PENDING"].join(
        "\t",
      ),
    );
    expect(fields).toHaveLength(10);
    expect(fields[6]).toBe("");
    expect(fields[7]).toBe("2");
    expect(fields[8]).toBe("1");
    expect(fields[9]).toBe("build:PENDING");
  });

  it("preserves runs of empty fields and a trailing empty field", () => {
    expect(splitState("a\t\t\tb\t")).toEqual(["a", "", "", "b", ""]);
  });

  it("keeps a populated thread list intact", () => {
    const fields = splitState(
      ["OPEN", "h", "b", "MERGEABLE", "5", "6", "PRRT_a;PRRT_b", "0", "0", "d"].join("\t"),
    );
    expect(fields[6]).toBe("PRRT_a;PRRT_b");
    expect(fields[9]).toBe("d");
  });
});

describe.skipIf(!hasBash)("watch_wake_rebase", () => {
  // The regression this whole file exists for.
  it("wakes on a branch that is merely behind, which reports MERGEABLE", () => {
    const emitted = wake('watch_wake_rebase 383 MERGEABLE 2 "headsha..basesha" ""');
    expect(emitted).toContain("branch behind base by 2");
    expect(emitted).toContain("key=headsha..basesha");
  });

  it("wakes on a conflicting branch", () => {
    expect(wake('watch_wake_rebase 383 CONFLICTING 0 "headsha..basesha" ""')).toContain(
      "branch conflicting with base",
    );
  });

  it("stays quiet when the branch is current", () => {
    expect(wake('watch_wake_rebase 383 MERGEABLE 0 "headsha..basesha" ""')).toBe("");
  });

  it("stays quiet when the pair has not moved since the floor", () => {
    expect(wake('watch_wake_rebase 383 MERGEABLE 2 "headsha..basesha" "headsha..basesha"')).toBe(
      "",
    );
  });

  it("re-arms when the base advances under an unchanged head", () => {
    // A head-only key would wedge here permanently: nothing can move the head
    // while the branch sits blocked, so the pair is what re-arms the budget.
    expect(wake('watch_wake_rebase 383 MERGEABLE 1 "headsha..newbase" "headsha..oldbase"')).toContain(
      "rebase due",
    );
  });

  it("stays quiet when behind_by is unreadable rather than guessing", () => {
    expect(wake('watch_wake_rebase 383 MERGEABLE "" "headsha..basesha" ""')).toBe("");
    expect(wake('watch_wake_rebase 383 UNKNOWN "notanumber" "headsha..basesha" ""')).toBe("");
  });
});

describe.skipIf(!hasBash)("watch_wake_ci_red", () => {
  it("wakes when checks have settled red", () => {
    expect(wake('watch_wake_ci_red 383 0 2 "headsha" ""')).toContain("checks settled red");
  });

  it("stays quiet while any check is still pending", () => {
    // A run in flight may yet go green, and the tick would idle on it anyway.
    expect(wake('watch_wake_ci_red 383 1 2 "headsha" ""')).toBe("");
  });

  it("stays quiet when everything passed", () => {
    expect(wake('watch_wake_ci_red 383 0 0 "headsha" ""')).toBe("");
  });

  it("fires once per red head, then re-arms on the next push", () => {
    expect(wake('watch_wake_ci_red 383 0 1 "headsha" "headsha"')).toBe("");
    expect(wake('watch_wake_ci_red 383 0 1 "newhead" "headsha"')).toContain("head=newhead");
  });
});

describe.skipIf(!hasBash)("watch_wake_review / watch_wake_comment", () => {
  it("wakes on an id above the floor", () => {
    expect(wake("watch_wake_review 383 500 400")).toContain("new submitted review id=500");
    expect(wake("watch_wake_comment 383 500 400")).toContain("new thread comment id=500");
  });

  it("stays quiet at or below the floor", () => {
    expect(wake("watch_wake_review 383 400 400")).toBe("");
    expect(wake("watch_wake_review 383 399 400")).toBe("");
    expect(wake("watch_wake_comment 383 400 400")).toBe("");
  });

  it("treats an empty floor as zero rather than erroring", () => {
    expect(wake('watch_wake_review 383 1 ""')).toContain("id=1");
  });
});

describe.skipIf(!hasBash)("watch_wake_thread", () => {
  it("wakes on a thread not in the known set", () => {
    expect(wake('watch_wake_thread 383 "PRRT_new" "PRRT_a;PRRT_b"')).toContain(
      "thread newly unresolved id=PRRT_new",
    );
  });

  it("stays quiet on a thread already known unresolved", () => {
    expect(wake('watch_wake_thread 383 "PRRT_b" "PRRT_a;PRRT_b"')).toBe("");
  });

  it("matches whole ids, not substrings", () => {
    // "PRRT_a" must not be considered known because "PRRT_abc" is present.
    expect(wake('watch_wake_thread 383 "PRRT_a" "PRRT_abc"')).toContain("newly unresolved");
  });

  it("stays quiet on an empty id", () => {
    expect(wake('watch_wake_thread 383 "" "PRRT_a"')).toBe("");
  });
});

describe.skipIf(!hasBash)("watch_wake_blocked_resume", () => {
  it("is dormant when the watch is not blocked", () => {
    expect(wake('watch_wake_blocked_resume 383 "build:SUCCESS" ""')).toBe("");
  });

  it("wakes on any digest move while blocked, including to green", () => {
    expect(wake('watch_wake_blocked_resume 383 "build:SUCCESS" "build:FAILURE"')).toContain(
      "ci digest moved while blocked",
    );
  });

  it("stays quiet while the digest is unchanged", () => {
    expect(wake('watch_wake_blocked_resume 383 "build:FAILURE" "build:FAILURE"')).toBe("");
  });
});
