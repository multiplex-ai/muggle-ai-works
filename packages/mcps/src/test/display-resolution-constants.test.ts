/** Tests for the DisplayResolution size table and the schema the local run tools validate it with. */

import { describe, expect, it } from "vitest";

import { DisplayResolutionSchema } from "../mcp/local/contracts/project-schemas.js";
import { DISPLAY_PARAMS_BY_RESOLUTION } from "../mcp/local/services/display-resolution-constants.js";
import { DisplayResolution } from "../mcp/local/types/enums.js";

const RESOLUTION_NAME_PATTERN = /^R_(\d{4})x(\d{4})$/;

describe("DISPLAY_PARAMS_BY_RESOLUTION", () => {
  it.each(Object.values(DisplayResolution))("sizes %s at the width and height its name encodes", (resolution) => {
    const nameMatch = RESOLUTION_NAME_PATTERN.exec(resolution);

    expect(nameMatch).not.toBeNull();
    expect(DISPLAY_PARAMS_BY_RESOLUTION[resolution]).toEqual({
      browserWindowWidth: Number(nameMatch?.[1]),
      browserWindowHeight: Number(nameMatch?.[2]),
    });
  });

  it("has no entry for a value outside the enum", () => {
    expect(Object.keys(DISPLAY_PARAMS_BY_RESOLUTION).sort()).toEqual(Object.values(DisplayResolution).sort());
  });
});

describe("DisplayResolutionSchema", () => {
  it("accepts every device-grouped resolution the cloud defines", () => {
    expect(DisplayResolutionSchema.parse("R_1512x0982")).toBe(DisplayResolution.R_1512x0982);
    expect(DisplayResolutionSchema.parse("R_2560x1440")).toBe(DisplayResolution.R_2560x1440);
    expect(Object.values(DisplayResolution)).toHaveLength(16);
  });

  it("rejects a resolution the cloud does not define", () => {
    expect(DisplayResolutionSchema.safeParse("R_1280x0720").success).toBe(false);
  });
});
