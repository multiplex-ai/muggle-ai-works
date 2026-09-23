/**
 * Tests for the local run viewer.
 *
 * The shapes asserted here are taken from real sessions: a run whose steps carry sparse operation
 * fields, a screenshot directory mixing `stepNNN_`-prefixed frames with bare-hash ones, and a run
 * that died before writing an action script. Each of those cost time to discover by hand.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "run-view-test-"));

vi.mock("../shared/data-dir.js", () => ({
  getDataDir: () => tempRoot,
}));

/** Outcome the run storage reports for the next read; null stands for "storage has no record". */
let recordedRunOutcome: string | null = null;

vi.mock("../mcp/local/services/run-result-storage-service.js", () => ({
  getRunResultStorageService: () => ({
    getRunResult: () => (recordedRunOutcome === null ? undefined : { status: recordedRunOutcome }),
  }),
}));

const sessionsDir = path.join(tempRoot, "sessions");

const writeRun = (
  runId: string,
  actionScript: unknown,
  frames: string[] = [],
): string => {
  const sessionPath = path.join(sessionsDir, runId);
  fs.mkdirSync(path.join(sessionPath, "electron-runtime", "screenshot"), { recursive: true });
  if (actionScript !== undefined) {
    fs.writeFileSync(path.join(sessionPath, "action-script.json"), JSON.stringify(actionScript));
  }
  for (const frame of frames) {
    // A one-pixel JPEG header is enough: the renderer only reads bytes to inline them.
    fs.writeFileSync(path.join(sessionPath, "electron-runtime", "screenshot", frame), Buffer.from([0xff, 0xd8, 0xff]));
  }
  return sessionPath;
};

const navigateRun = {
  actionScriptName: "Deep link without a test case id shows a toast",
  status: "failed",
  steps: [
    {
      briefExplanation: "Workflow started at url",
      operation: { action: "navigate", url: "https://example.test/scripts?modal=script-details", screenshot: "user_data/runtime/x/screenshot/aaa_screenshot.jpg" },
    },
    {
      briefExplanation: "Click 'Accept all' button to dismiss cookie consent.",
      operation: { action: "click", screenshot: "user_data/runtime/x/screenshot/bbb_screenshot.jpg" },
    },
  ],
  summaryStep: { briefExplanation: "Failed. The notification is not visible." },
};

beforeEach(() => {
  fs.rmSync(sessionsDir, { recursive: true, force: true });
  fs.mkdirSync(sessionsDir, { recursive: true });
  recordedRunOutcome = null;
});

afterEach(() => {
  vi.resetModules();
});

describe("readRunView", () => {
  it("reads steps, frames and the closing verdict", async () => {
    writeRun("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", navigateRun, ["aaa_screenshot.jpg", "step001_bbb_screenshot.jpg"]);
    const { readRunView } = await import("../mcp/local/services/run-view/index.js");

    const runView = readRunView("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    expect(runView.title).toBe("Deep link without a test case id shows a toast");
    expect(runView.verdict).toContain("not visible");
    expect(runView.steps).toHaveLength(2);
    expect(runView.steps[0].action).toBe("navigate");
    expect(runView.steps[0].url).toContain("modal=script-details");
    expect(runView.screenshotCount).toBe(2);
  });

  it("reports the recorded run outcome, never the action script's own status", async () => {
    // Caught on a real session: the action script says "active" for a run that failed, because
    // that field describes the script. Reading it as the run's status labels failures as running.
    writeRun("ee111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { ...navigateRun, status: "active" });
    recordedRunOutcome = "failed";
    const { readRunView } = await import("../mcp/local/services/run-view/index.js");

    expect(readRunView("ee111111").status).toBe("failed");
  });

  it("says nothing about status when the storage has no record of the run", async () => {
    writeRun("ff111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { ...navigateRun, status: "active" });
    const { readRunView, renderRunViewText } = await import("../mcp/local/services/run-view/index.js");

    const runView = readRunView("ff111111");

    expect(runView.status).toBeNull();
    expect(renderRunViewText(runView, { includeHtmlOffer: true })).toContain("status unrecorded");
  });

  it("matches a frame stored under a stepNNN_ prefix the action script does not record", async () => {
    writeRun("22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa", navigateRun, ["aaa_screenshot.jpg", "step001_bbb_screenshot.jpg"]);
    const { readRunView } = await import("../mcp/local/services/run-view/index.js");

    const runView = readRunView("22222222");

    expect(runView.steps[1].screenshotPath).toContain("step001_bbb_screenshot.jpg");
  });

  it("resolves a run from a unique prefix, and refuses an ambiguous one", async () => {
    writeRun("33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa", navigateRun);
    writeRun("33333333-bbbb-4bbb-8bbb-bbbbbbbbbbbb", navigateRun);
    const { readRunView, RunViewError } = await import("../mcp/local/services/run-view/index.js");

    expect(() => readRunView("33333333")).toThrow(RunViewError);
    expect(() => readRunView("33333333-aaaa")).not.toThrow();
  });

  it("takes the newest run when given no id", async () => {
    writeRun("44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { ...navigateRun, actionScriptName: "older" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    writeRun("55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { ...navigateRun, actionScriptName: "newer" });
    const { readRunView } = await import("../mcp/local/services/run-view/index.js");

    expect(readRunView().title).toBe("newer");
  });

  it("names the path when a run died before writing an action script", async () => {
    writeRun("66666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa", undefined);
    const { readRunView, RunViewError } = await import("../mcp/local/services/run-view/index.js");

    expect(() => readRunView("66666666")).toThrow(RunViewError);
    expect(() => readRunView("66666666")).toThrow(/action-script\.json/);
  });

  it("reports a step with no frame rather than failing the read", async () => {
    writeRun("77777777-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
      steps: [{ briefExplanation: "no frame here", operation: { action: "click" } }],
    });
    const { readRunView } = await import("../mcp/local/services/run-view/index.js");

    const runView = readRunView("77777777");

    expect(runView.steps[0].screenshotPath).toBeNull();
    expect(runView.steps[0].action).toBe("click");
  });
});

describe("renderRunViewText", () => {
  it("offers the HTML view on every terminal render", async () => {
    writeRun("88888888-aaaa-4aaa-8aaa-aaaaaaaaaaaa", navigateRun, ["aaa_screenshot.jpg"]);
    const { readRunView, renderRunViewText, HTML_VIEW_OFFER_LINE } = await import("../mcp/local/services/run-view/index.js");

    const passing = renderRunViewText(
      { ...readRunView("88888888"), status: "passed", verdict: null },
      { includeHtmlOffer: true },
    );
    const failing = renderRunViewText(readRunView("88888888"), { includeHtmlOffer: true });

    // The affordance is unconditional: a passing run is exactly when someone stops looking, and
    // is also when a verdict that disagrees with its frames goes unnoticed.
    expect(passing).toContain(HTML_VIEW_OFFER_LINE);
    expect(failing).toContain(HTML_VIEW_OFFER_LINE);
  });

  it("prints the verdict after the steps", async () => {
    writeRun("99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa", navigateRun, ["aaa_screenshot.jpg"]);
    const { readRunView, renderRunViewText } = await import("../mcp/local/services/run-view/index.js");

    const text = renderRunViewText(readRunView("99999999"), { includeHtmlOffer: true });

    expect(text.indexOf("Verdict:")).toBeGreaterThan(text.indexOf("Accept all"));
  });

  it("says so when a run recorded no steps", async () => {
    writeRun("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { status: "failed", steps: [] });
    const { readRunView, renderRunViewText } = await import("../mcp/local/services/run-view/index.js");

    expect(renderRunViewText(readRunView("aaaaaaaa"), { includeHtmlOffer: true })).toContain("no steps recorded");
  });
});

describe("renderRunViewHtml", () => {
  it("inlines frames so the page survives being sent to someone", async () => {
    writeRun("bbbbbbbb-aaaa-4aaa-8aaa-aaaaaaaaaaaa", navigateRun, ["aaa_screenshot.jpg", "step001_bbb_screenshot.jpg"]);
    const { readRunView, renderRunViewHtml } = await import("../mcp/local/services/run-view/index.js");

    const html = renderRunViewHtml(readRunView("bbbbbbbb"));

    expect(html).toContain("data:image/jpeg;base64,");
    expect(html).not.toMatch(/<img[^>]+src="(?!data:)/);
  });

  it("escapes run-supplied text into the page", async () => {
    writeRun("cccccccc-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
      actionScriptName: "<script>alert(1)</script>",
      steps: [{ briefExplanation: "a & b < c", operation: { action: "click" } }],
    });
    const { readRunView, renderRunViewHtml } = await import("../mcp/local/services/run-view/index.js");

    const html = renderRunViewHtml(readRunView("cccccccc"));

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("a &amp; b &lt; c");
  });

  it("creates the output directory a --out-dir names", async () => {
    writeRun("eeeeeeee-aaaa-4aaa-8aaa-aaaaaaaaaaaa", navigateRun, ["aaa_screenshot.jpg"]);
    const { readRunView, writeRunViewHtml } = await import("../mcp/local/services/run-view/index.js");
    const outputDir = path.join(tempRoot, "fresh-out", "nested");

    const writtenPath = writeRunViewHtml(readRunView("eeeeeeee"), outputDir);

    expect(fs.existsSync(writtenPath)).toBe(true);
  });

  it("leaves the session directory untouched", async () => {
    const sessionPath = writeRun("dddddddd-aaaa-4aaa-8aaa-aaaaaaaaaaaa", navigateRun, ["aaa_screenshot.jpg"]);
    const before = fs.readdirSync(sessionPath).sort();
    const { readRunView, renderRunViewHtml } = await import("../mcp/local/services/run-view/index.js");

    renderRunViewHtml(readRunView("dddddddd"));

    expect(fs.readdirSync(sessionPath).sort()).toEqual(before);
  });
});
