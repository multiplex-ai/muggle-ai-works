import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { STOPPED_SLOT_SUFFIX, TERMINAL_SLOT_PR_STATES } from "../guardrails/constants.js";
import { parsePrUrl } from "../pr-walkthrough/gh.js";
import { PR_POLLING_DISABLED_FILE, WATCH_REGISTRATION_FILE } from "./constants.js";
import { optionalString } from "./field-parsers.js";
import type { SlotPr, WatchSlotRecord, WatchSlotRegistration } from "./types.js";

interface PrsJsonEntry {
  url?: unknown;
  state?: unknown;
  provider?: unknown;
  head_sha?: unknown;
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
  } catch {
    return undefined;
  }
}

// Only GitHub PRs are tracked; a GitLab MR's slot is read but owes nothing here,
// because every live check goes through `gh`.
function openGithubPrsOf(prsJson: unknown): SlotPr[] {
  const entries = (Array.isArray(prsJson) ? prsJson : prsJson ? [prsJson] : []) as PrsJsonEntry[];
  const openPrs: SlotPr[] = [];
  for (const entry of entries) {
    const recordedState = typeof entry.state === "string" ? entry.state.toLowerCase() : "";
    if ((TERMINAL_SLOT_PR_STATES as readonly string[]).includes(recordedState)) continue;
    if (entry.provider !== undefined && entry.provider !== "github") continue;
    const url = optionalString(entry.url);
    const coordinates = url ? parsePrUrl(url) : null;
    if (!url || !coordinates) continue;
    openPrs.push({
      repo: coordinates.repo,
      number: coordinates.prNumber,
      url: url,
      headSha: optionalString(entry.head_sha),
    });
  }
  return openPrs;
}

function heartbeatMtimeMsOf(slotDir: string): number | undefined {
  try {
    return statSync(join(slotDir, "watch-heartbeat")).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * Every slot that still owes a watch: not stopped by its owner, not finalized,
 * and holding at least one open GitHub PR.
 *
 * Output shape: `[{ slug: "csv-export", slotDir: "…/sessions/csv-export", ownerSessionId: "b34c…", isRegistered: true, openPrs: [{ repo: "o/r", number: 7, url: "…" }] }]`
 */
export function readOpenWatchSlots(slotsDir: string): WatchSlotRecord[] {
  let slugs: string[];
  try {
    slugs = readdirSync(slotsDir);
  } catch {
    return [];
  }
  const slots: WatchSlotRecord[] = [];
  for (const slug of slugs) {
    if (slug.endsWith(STOPPED_SLOT_SUFFIX)) continue;
    const slotDir = join(slotsDir, slug);
    if (existsSync(join(slotDir, "result.md"))) continue;
    const openPrs = openGithubPrsOf(readJsonFile(join(slotDir, "prs.json")));
    if (openPrs.length === 0) continue;
    const owner = readJsonFile(join(slotDir, "owner.json")) as { session_id?: unknown } | undefined;
    slots.push({
      slug: slug,
      slotDir: slotDir,
      ownerSessionId: optionalString(owner?.session_id),
      heartbeatMtimeMs: heartbeatMtimeMsOf(slotDir),
      isRegistered: existsSync(join(slotDir, WATCH_REGISTRATION_FILE)),
      openPrs: openPrs,
    });
  }
  return slots;
}

/** Whether the owner switched every PR watch off with `polling.disabled`. */
export function isPrPollingDisabled(slotsDir: string): boolean {
  return existsSync(join(dirname(slotsDir), PR_POLLING_DISABLED_FILE));
}

/**
 * Opt a slot into out-of-session recovery. Re-registering only refreshes the
 * timestamp, so every arm can call it.
 *
 * @throws When the slot dir has no `prs.json` — there is nothing to watch yet.
 */
export function writeSlotRegistration(slotDir: string, registeredBy: string, now: Date): void {
  if (!existsSync(join(slotDir, "prs.json"))) {
    throw new Error(`${slotDir} has no prs.json — arm the watch before registering it`);
  }
  const registration: WatchSlotRegistration = {
    registered_at: now.toISOString(),
    registered_by: registeredBy,
  };
  writeFileSync(join(slotDir, WATCH_REGISTRATION_FILE), `${JSON.stringify(registration, null, 2)}\n`);
}

/** Withdraw a slot from out-of-session recovery; the watch still reports on it. */
export function removeSlotRegistration(slotDir: string): boolean {
  const registrationPath = join(slotDir, WATCH_REGISTRATION_FILE);
  if (!existsSync(registrationPath)) return false;
  rmSync(registrationPath);
  return true;
}
