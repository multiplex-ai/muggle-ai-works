import { describe, expect, it } from "vitest";
import { loadWebVoyagerTasks } from "./webvoyager-source";

describe("loadWebVoyagerTasks", () => {
  it("maps one JSONL line to a BenchmarkTask", () => {
    const line = JSON.stringify({
      web_name: "Allrecipes",
      id: "Allrecipes--3",
      ques: "Find a recipe for grilled salmon with over 50 reviews.",
      web: "https://www.allrecipes.com/",
    });

    const tasks = loadWebVoyagerTasks(line);

    expect(tasks).toEqual([
      {
        taskId: "Allrecipes--3",
        siteName: "Allrecipes",
        instruction: "Find a recipe for grilled salmon with over 50 reviews.",
        startUrl: "https://www.allrecipes.com/",
      },
    ]);
  });

  it("skips blank lines", () => {
    const content = `\n\n${JSON.stringify({
      web_name: "Apple",
      id: "Apple--1",
      ques: "q",
      web: "https://apple.com",
    })}\n`;

    expect(loadWebVoyagerTasks(content)).toHaveLength(1);
  });

  it("throws naming the line number when a required field is missing", () => {
    const content = JSON.stringify({
      web_name: "Apple",
      id: "Apple--1",
      web: "https://apple.com",
    });

    expect(() => loadWebVoyagerTasks(content)).toThrow(/line 1.*ques/);
  });

  it("throws naming the line number when a line is not valid JSON", () => {
    expect(() => loadWebVoyagerTasks("{not json")).toThrow(/line 1.*valid JSON/);
  });
});
