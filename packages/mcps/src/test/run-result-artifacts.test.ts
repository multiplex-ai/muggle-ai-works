import { describe, expect, it } from "vitest";

import { findFailingStepScreenshot } from "../mcp/tools/local/run-result-artifacts.js";

describe("findFailingStepScreenshot", () => {
  it("returns the highest-numbered step frame, ignoring non-step files", () => {
    const files = [
      "step001_aaa_screenshot.jpg",
      "step005_bbb_screenshot.jpg",
      "595ad8b68bb634e67c9b_screenshot.jpg",
      "step003_ccc_screenshot.jpg",
    ];
    expect(findFailingStepScreenshot(files)).toEqual({
      file: "step005_bbb_screenshot.jpg",
      stepNum: 5,
    });
  });

  it("parses the zero-padded step index numerically", () => {
    expect(findFailingStepScreenshot(["step010_a_screenshot.jpg"])?.stepNum).toBe(10);
  });

  it("returns undefined when no step frames are present", () => {
    expect(findFailingStepScreenshot(["random_screenshot.jpg"])).toBeUndefined();
    expect(findFailingStepScreenshot([])).toBeUndefined();
  });
});
