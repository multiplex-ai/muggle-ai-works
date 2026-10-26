import { WATCH_FIXTURE_REPO } from "./constants.js";
import type { WatchSlotFixture } from "./types.js";

/** A fixture PR's url. */
export function watchFixturePrUrl(prNumber: number): string {
  return `https://github.com/${WATCH_FIXTURE_REPO}/pull/${prNumber}`;
}

/**
 * The files of a muggle-do slot whose watch recorded due work, keyed by file name, in the shapes the arm script,
 * the loop, and the skill prose write them.
 *
 * Output shape: `{ "prs.json": "[...]", "owner.json": "{...}", "last_seen.json": "{...}", "watch-due.env": "HEAD=..." }`
 */
export function watchSlotFiles(fixture: WatchSlotFixture): Record<string, string> {
  const dueLines = `HEAD="${fixture.headSha}"\nREBASE_DUE="${fixture.rebaseDueKey ?? ""}"\nCI_RED_HEAD="${fixture.ciRedHeadSha ?? ""}"\n`;
  const isNothingDue = !fixture.rebaseDueKey && !fixture.ciRedHeadSha;
  return {
    "prs.json": JSON.stringify([
      {
        repo: WATCH_FIXTURE_REPO,
        provider: "github",
        number: fixture.prNumber,
        url: watchFixturePrUrl(fixture.prNumber),
        head_sha: fixture.headSha,
        state: fixture.prState ?? "open",
      },
    ]),
    "owner.json": JSON.stringify({ session_id: fixture.ownerSessionId, claimed_at: "2026-01-01T00:00:00Z" }, null, 2),
    "last_seen.json": JSON.stringify({ [`${WATCH_FIXTURE_REPO}#${fixture.prNumber}`]: fixture.lastSeenEntry ?? {} }),
    "watch-due.env": isNothingDue ? "" : dueLines,
  };
}
