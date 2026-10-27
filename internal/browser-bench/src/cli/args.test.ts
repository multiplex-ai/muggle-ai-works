import { describe, expect, it } from "vitest";
import { DEFAULT_CONCURRENCY, MAX_STEPS_PER_TASK } from "../domain/constants";
import { ModelSource } from "../domain/types";
import { parseCliArgs } from "./args";

const parse = (argv: string[]) =>
  parseCliArgs({
    argv: argv,
    defaultTasksPath: "/defaults/webvoyager-smoke.jsonl",
    defaultOutDir: "/defaults/reports",
  });

describe("parseCliArgs model source", () => {
  it("reads a known model source", () => {
    expect(parse(["--model-source", "claude-code"]).modelSource).toBe(ModelSource.ClaudeCode);
  });

  it("rejects an unknown model source and names the accepted ones", () => {
    expect(() => parse(["--model-source", "gpt"])).toThrow(/anthropic, claude-code/);
  });
});

describe("parseCliArgs", () => {
  it("falls back to the injected defaults when no flags are given", () => {
    expect(parse([])).toEqual({
      tasksPath: "/defaults/webvoyager-smoke.jsonl",
      concurrency: DEFAULT_CONCURRENCY,
      outDir: "/defaults/reports",
      resume: false,
      maxSteps: MAX_STEPS_PER_TASK,
    });
  });

  it("reads every value flag", () => {
    expect(
      parse(["--tasks", "/tmp/all.jsonl", "--limit", "5", "--concurrency", "4", "--out", "/tmp/run"]),
    ).toEqual({
      tasksPath: "/tmp/all.jsonl",
      taskLimit: 5,
      concurrency: 4,
      outDir: "/tmp/run",
      resume: false,
      maxSteps: MAX_STEPS_PER_TASK,
    });
  });

  it("treats --resume as a switch that takes no value", () => {
    expect(parse(["--resume", "--limit", "2"])).toMatchObject({ resume: true, taskLimit: 2 });
  });

  it("leaves the limit absent so the whole task file runs", () => {
    expect(parse([])).not.toHaveProperty("taskLimit");
  });

  it("rejects an unknown flag and names the accepted ones", () => {
    expect(() => parse(["--judge"])).toThrow(/Unknown flag --judge.*--tasks/s);
  });

  it("rejects a value flag with nothing after it", () => {
    expect(() => parse(["--tasks"])).toThrow(/--tasks needs a value/);
  });

  it("rejects a value flag swallowing the next flag as its value", () => {
    expect(() => parse(["--tasks", "--resume"])).toThrow(/--tasks needs a value/);
  });

  it("rejects a non-numeric count", () => {
    expect(() => parse(["--limit", "many"])).toThrow(/--limit needs a positive whole number/);
  });

  it("rejects a fractional count", () => {
    expect(() => parse(["--concurrency", "1.5"])).toThrow(/positive whole number/);
  });

  it("rejects a zero count", () => {
    expect(() => parse(["--concurrency", "0"])).toThrow(/positive whole number/);
  });
});

describe("step budget flag", () => {
  it("defaults to WebVoyager's own cap so results stay comparable", () => {
    expect(
      parseCliArgs({ argv: [], defaultTasksPath: "t.jsonl", defaultOutDir: "out" }).maxSteps,
    ).toBe(MAX_STEPS_PER_TASK);
  });

  it("accepts a raised budget, which the report then has to disclose", () => {
    expect(
      parseCliArgs({
        argv: ["--max-steps", "30"],
        defaultTasksPath: "t.jsonl",
        defaultOutDir: "out",
      }).maxSteps,
    ).toBe(30);
  });

  it("rejects a budget that is not a positive whole number", () => {
    expect(() =>
      parseCliArgs({ argv: ["--max-steps", "0"], defaultTasksPath: "t.jsonl", defaultOutDir: "out" }),
    ).toThrow(/max-steps/i);
  });
});

describe("sampling flags", () => {
  const parse = (argv: string[]) =>
    parseCliArgs({ argv: argv, defaultTasksPath: "t.jsonl", defaultOutDir: "out" });

  it("leaves sampling off by default, so the task file runs as given", () => {
    expect(parse([]).sampleSize).toBeUndefined();
    expect(parse([]).sampleSeed).toBeUndefined();
  });

  it("accepts a size and seed together", () => {
    const options = parse(["--sample-size", "100", "--sample-seed", "20260906"]);

    expect(options.sampleSize).toBe(100);
    expect(options.sampleSeed).toBe(20260906);
  });

  it("refuses a sample size with no seed, which would be irreproducible", () => {
    expect(() => parse(["--sample-size", "100"])).toThrow(/must be given together/);
  });

  it("refuses a seed with no sample size", () => {
    expect(() => parse(["--sample-seed", "7"])).toThrow(/must be given together/);
  });

  it("rejects a sample size that is not a positive whole number", () => {
    expect(() => parse(["--sample-size", "0", "--sample-seed", "7"])).toThrow(/sample-size/i);
  });
});
