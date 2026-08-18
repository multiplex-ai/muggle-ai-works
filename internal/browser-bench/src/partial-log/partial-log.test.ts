import { describe, expect, it } from "vitest";
import { BenchmarkOutcome, type BenchmarkTask, type TaskResult } from "../domain/types";
import {
  mergeResultsInTaskOrder,
  parsePartialLog,
  selectPendingTasks,
  serializePartialLogEntry,
} from "./partial-log";

const task = (taskId: string): BenchmarkTask => ({
  taskId: taskId,
  siteName: "Test",
  instruction: "do it",
  startUrl: "https://example.com",
});

const result = (taskId: string): TaskResult => ({
  taskId: taskId,
  outcome: BenchmarkOutcome.Pass,
  finalAnswer: "",
  studioStatus: "success",
  stepCount: 1,
  durationMs: 10,
  tokensUsed: 0,
  trajectoryDir: "/tmp",
});

describe("serializePartialLogEntry", () => {
  it("emits one newline-terminated JSON line", () => {
    const line = serializePartialLogEntry(result("Amazon--0"));

    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual(result("Amazon--0"));
  });
});

describe("parsePartialLog", () => {
  it("round-trips appended entries", () => {
    const logContent = [result("Amazon--0"), result("Apple--0")].map(serializePartialLogEntry).join("");

    expect(parsePartialLog(logContent).map((entry) => entry.taskId)).toEqual([
      "Amazon--0",
      "Apple--0",
    ]);
  });

  it("keeps the entries before a line truncated by a killed run", () => {
    const logContent = `${serializePartialLogEntry(result("Amazon--0"))}{"taskId":"Apple--0","outc`;

    expect(parsePartialLog(logContent).map((entry) => entry.taskId)).toEqual(["Amazon--0"]);
  });

  it("returns nothing for an empty log", () => {
    expect(parsePartialLog("")).toEqual([]);
  });
});

describe("selectPendingTasks", () => {
  it("drops tasks already recorded and keeps the rest in order", () => {
    const pending = selectPendingTasks({
      tasks: [task("Amazon--0"), task("Apple--0"), task("ArXiv--0")],
      completedResults: [result("Apple--0")],
    });

    expect(pending.map((pendingTask) => pendingTask.taskId)).toEqual(["Amazon--0", "ArXiv--0"]);
  });

  it("keeps every task when nothing was recorded", () => {
    expect(
      selectPendingTasks({ tasks: [task("Amazon--0")], completedResults: [] }),
    ).toHaveLength(1);
  });
});

describe("mergeResultsInTaskOrder", () => {
  it("orders resumed and fresh results by the task file, not by when they landed", () => {
    const ordered = mergeResultsInTaskOrder({
      tasks: [task("Amazon--0"), task("Apple--0"), task("ArXiv--0")],
      results: [result("ArXiv--0"), result("Amazon--0"), result("Apple--0")],
    });

    expect(ordered.map((entry) => entry.taskId)).toEqual(["Amazon--0", "Apple--0", "ArXiv--0"]);
  });

  it("drops a result whose task is not in this run", () => {
    const ordered = mergeResultsInTaskOrder({
      tasks: [task("Amazon--0")],
      results: [result("Amazon--0"), result("Coursera--9")],
    });

    expect(ordered.map((entry) => entry.taskId)).toEqual(["Amazon--0"]);
  });
});
