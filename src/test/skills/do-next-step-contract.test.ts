/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins muggle-do's ending selector (`do/next-step.md`) to the chat that ran it.
 * The sessions directory holds every chat's slots, so a selector drawn from the
 * whole directory surfaces work this chat never touched while saying nothing
 * about the work it did. The step reports this chat's work first, offers only
 * follow-ups that report shows, and keeps other chats behind one explicit option.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { headingAnchors, sectionBody } from "./helpers/markdown-sections";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DO_DIR = path.resolve(__dirname, "../../../plugin/skills/do");
const NEXT_STEP_PATH = path.join(DO_DIR, "next-step.md");

const NEXT_STEP = fs.readFileSync(NEXT_STEP_PATH, "utf8");
const SCOPE = sectionBody(NEXT_STEP, /^## This chat's work$/m);
const PROCEDURE = sectionBody(NEXT_STEP, /^## Procedure$/m);
const STATUS_BLOCK = sectionBody(NEXT_STEP, /^## Status block$/m);
const SELECTOR = sectionBody(NEXT_STEP, /^## Selector$/m);

describe("do/next-step.md — scope is this chat", () => {
  it("identifies this chat's slots by owner.json against the running session id", () => {
    expect(SCOPE).toMatch(/\$CLAUDE_CODE_SESSION_ID/);
    expect(SCOPE).toMatch(/owner\.json/);
    expect(SCOPE).toMatch(/reconcile\.md/);
  });

  it("narrows to the terminal slug alone when the session id is unset", () => {
    expect(SCOPE).toMatch(/id unset, this chat's work is `<slug>` alone/i);
  });
});

describe("do/next-step.md — status before the question", () => {
  it("prints the status block before asking", () => {
    expect(PROCEDURE).toMatch(/print the \[status block\].*then ask/i);
    expect(PROCEDURE).toMatch(/status block always comes first/i);
  });

  it("reports every slot of this chat's work, the terminal slug first", () => {
    expect(STATUS_BLOCK).toMatch(/one line per slot of this chat's work, `<slug>` first/i);
    for (const state of ["merged", "open", "blocked", "closed"]) {
      expect(STATUS_BLOCK).toMatch(new RegExp(`^  ${state} `, "m"));
    }
  });

  it("lists what this chat left unfinished", () => {
    expect(STATUS_BLOCK).toMatch(/^Left over:/m);
    expect(STATUS_BLOCK).toMatch(/\[E2E FAILING\]/);
  });

  it("keeps other chats out of the block", () => {
    expect(STATUS_BLOCK).toMatch(/no other chat's slot appears in the block/i);
  });
});

describe("do/next-step.md — selector", () => {
  it("stays within AskUserQuestion's four-option cap", () => {
    expect(SELECTOR).toMatch(/at most four options, in this order/i);
  });

  it("offers only follow-ups the status block shows", () => {
    expect(SELECTOR).toMatch(/each naming the status-block line it acts on/i);
    expect(SELECTOR).toMatch(/no generic suggestion, no other chat's PR/i);
  });

  it("offers Clean up now only when teardown did not run", () => {
    expect(SELECTOR).toMatch(/\*\*Clean up now\*\*.*when `teardownRan` is false/i);
  });

  it("always offers the shift to other chats' work, without adopting implicitly", () => {
    expect(SELECTOR).toMatch(/\*\*Other chats' work\*\* — always present/i);
    expect(SELECTOR).toMatch(/adopt\.md/);
    expect(SELECTOR).toMatch(/listing adopts nothing/i);
  });

  it("orders this chat, then other chats, then done", () => {
    const thisChat = SELECTOR.indexOf("**This chat's follow-ups**");
    const otherChats = SELECTOR.indexOf("**Other chats' work**");
    const done = SELECTOR.indexOf("**Done — stop here**");
    expect(thisChat).toBeGreaterThan(-1);
    expect(otherChats).toBeGreaterThan(thisChat);
    expect(done).toBeGreaterThan(otherChats);
  });
});

describe("do/next-step.md — preserved behavior", () => {
  it("still advances silently while the plan has pending items", () => {
    expect(PROCEDURE).toMatch(/pending items remain\*\* → do not prompt/i);
  });

  it("still logs the chosen outcome", () => {
    expect(PROCEDURE).toMatch(/append the chosen outcome to `followup\.log`/i);
  });
});

describe("do/next-step.md — links resolve", () => {
  const links = [...NEXT_STEP.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);

  it.each(links)("%s", (link) => {
    const [relativePath, anchor] = link.split("#");
    const targetPath = relativePath ? path.resolve(DO_DIR, relativePath) : NEXT_STEP_PATH;
    expect(fs.existsSync(targetPath)).toBe(true);
    if (anchor) {
      expect(headingAnchors(fs.readFileSync(targetPath, "utf8"))).toContain(anchor);
    }
  });
});
