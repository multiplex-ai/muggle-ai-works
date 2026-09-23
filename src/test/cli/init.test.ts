import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const onboardingMocks = vi.hoisted(() => ({
  applyOnboardingAnswers: vi.fn(() => ({ isCompleted: true, preferences: { autoLogin: "always" } })),
  needsOnboarding: vi.fn(() => true),
}));

const readlineMocks = vi.hoisted(() => ({
  answers: [] as string[],
  question: vi.fn(),
  close: vi.fn(),
}));

vi.mock("../../../packages/mcps/src/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../packages/mcps/src/index.js")>();
  return {
    ...actual,
    applyOnboardingAnswers: onboardingMocks.applyOnboardingAnswers,
    needsOnboarding: onboardingMocks.needsOnboarding,
  };
});

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: readlineMocks.question,
    close: readlineMocks.close,
  }),
}));

const { initCommand } = await import("../../cli/init/init-command.js");

let tempDir: string;
let logLines: string[];
let errorLines: string[];

function answersFile(contents: unknown): string {
  const filePath = path.join(tempDir, "answers.json");
  fs.writeFileSync(filePath, JSON.stringify(contents), "utf-8");
  return filePath;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-init-"));
  logLines = [];
  errorLines = [];
  vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
    logLines.push(String(line ?? ""));
  });
  vi.spyOn(console, "error").mockImplementation((line?: unknown) => {
    errorLines.push(String(line ?? ""));
  });
  readlineMocks.answers = [];
  readlineMocks.question.mockImplementation(() =>
    Promise.resolve(readlineMocks.answers.shift() ?? ""),
  );
  onboardingMocks.applyOnboardingAnswers.mockClear();
  process.exitCode = undefined;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("muggle init --json", () => {
  it("emits a renderable plan", async () => {
    await initCommand({ json: true });

    const plan = JSON.parse(logLines.join("\n")) as {
      primerHeadline: string;
      primerBullets: string[];
      blanketOptions: unknown[];
      groups: unknown[];
    };

    expect(plan.primerHeadline).toContain("real browser");
    expect(plan.primerBullets.length).toBeGreaterThan(0);
    expect(plan.blanketOptions).toHaveLength(4);
    expect(plan.groups.length).toBeGreaterThan(0);
    expect(onboardingMocks.applyOnboardingAnswers).not.toHaveBeenCalled();
  });
});

describe("muggle init --apply", () => {
  it("applies answers from a file", async () => {
    await initCommand({ apply: answersFile({ blanket: "accept-defaults" }) });

    expect(onboardingMocks.applyOnboardingAnswers).toHaveBeenCalledWith(
      expect.objectContaining({ blanket: "accept-defaults" }),
    );
    expect(logLines.join("\n")).toContain("Preferences saved.");
    expect(process.exitCode).toBeUndefined();
  });

  it("rejects an unknown disposition", async () => {
    await initCommand({ apply: answersFile({ blanket: "whatever" }) });

    expect(onboardingMocks.applyOnboardingAnswers).not.toHaveBeenCalled();
    expect(errorLines.join("\n")).toContain("blanket");
    expect(process.exitCode).toBe(1);
  });

  it("rejects an unknown preference key", async () => {
    await initCommand({
      apply: answersFile({ blanket: "customize", selectedToggleKeys: ["notAKey"] }),
    });

    expect(onboardingMocks.applyOnboardingAnswers).not.toHaveBeenCalled();
    expect(errorLines.join("\n")).toContain("notAKey");
    expect(process.exitCode).toBe(1);
  });

  it("reports a skip that will be offered again", async () => {
    onboardingMocks.applyOnboardingAnswers.mockReturnValueOnce({
      isCompleted: false,
      preferences: {},
      skip: { offerCount: 1, isRetired: false },
    } as never);

    await initCommand({ apply: answersFile({ blanket: "skip" }) });

    expect(logLines.join("\n")).toContain("offer this again");
  });

  it("reports a skip that retired the walkthrough", async () => {
    onboardingMocks.applyOnboardingAnswers.mockReturnValueOnce({
      isCompleted: true,
      preferences: {},
      skip: { offerCount: 3, isRetired: true },
    } as never);

    await initCommand({ apply: answersFile({ blanket: "skip" }) });

    expect(logLines.join("\n")).toContain("will not ask again");
  });
});

describe("muggle init without a terminal", () => {
  it("refuses rather than hanging on stdin", async () => {
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    await initCommand({});

    expect(errorLines.join("\n")).toContain("--json");
    expect(process.exitCode).toBe(1);
    expect(onboardingMocks.applyOnboardingAnswers).not.toHaveBeenCalled();

    Object.defineProperty(process.stdin, "isTTY", { value: original, configurable: true });
  });
});

describe("muggle init interactive walkthrough", () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
  });

  it("shows the primer before asking anything", async () => {
    await initCommand({});

    expect(logLines.join("\n")).toContain("real browser");
  });

  it("accepts the recommended defaults on a bare Enter", async () => {
    await initCommand({});

    expect(onboardingMocks.applyOnboardingAnswers).toHaveBeenCalledWith({
      blanket: "accept-defaults",
    });
  });

  it("records the picked blanket disposition", async () => {
    readlineMocks.answers = ["2"];

    await initCommand({});

    expect(onboardingMocks.applyOnboardingAnswers).toHaveBeenCalledWith({
      blanket: "ask-everything",
    });
  });

  it("re-asks until the answer is in range", async () => {
    readlineMocks.answers = ["99", "abc", "2"];

    await initCommand({});

    expect(onboardingMocks.applyOnboardingAnswers).toHaveBeenCalledWith({
      blanket: "ask-everything",
    });
  });

  it("walks the groups and reports selections when customizing", async () => {
    readlineMocks.answers = ["3"];

    await initCommand({});

    const answers = onboardingMocks.applyOnboardingAnswers.mock.calls[0][0] as {
      blanket: string;
      selectedToggleKeys: string[];
      choices: Record<string, string>;
    };

    expect(answers.blanket).toBe("customize");
    expect(answers.selectedToggleKeys).toContain("autoLogin");
    expect(answers.selectedToggleKeys).not.toContain("verboseOutput");
    expect(answers.choices.defaultExecutionMode).toBe("local");
    expect(answers.choices.watcherLifetime).toBe("7d");
    expect(answers.choices.maxCatchUpRebases).toBe("20");
  });

  it("flips the toggles the user names", async () => {
    readlineMocks.answers = ["3", "1,4"];

    await initCommand({});

    const answers = onboardingMocks.applyOnboardingAnswers.mock.calls[0][0] as {
      selectedToggleKeys: string[];
    };

    expect(answers.selectedToggleKeys).not.toContain("autoLogin");
    expect(answers.selectedToggleKeys).toContain("verboseOutput");
  });

  it("ignores out-of-range toggle numbers", async () => {
    readlineMocks.answers = ["3", "99, 0, abc"];

    await initCommand({});

    const answers = onboardingMocks.applyOnboardingAnswers.mock.calls[0][0] as {
      selectedToggleKeys: string[];
    };

    expect(answers.selectedToggleKeys).toContain("autoLogin");
  });

  it("notes when setup has already been done", async () => {
    onboardingMocks.needsOnboarding.mockReturnValueOnce(false);

    await initCommand({});

    expect(logLines.join("\n")).toContain("already set up");
  });
});
