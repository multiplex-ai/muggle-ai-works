import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ELECTRON_APP_EXECUTABLE_PATH_SEGMENTS } from "../../../packages/mcps/src/shared/electron-app-executable-constants.js";

const postinstallSource = readFileSync(
  fileURLToPath(new URL("../../../scripts/postinstall.mjs", import.meta.url)),
  "utf-8",
);

describe("postinstall executable path", () => {
  it.each(Object.entries(ELECTRON_APP_EXECUTABLE_PATH_SEGMENTS))(
    "resolves the %s executable where the runtime looks for it",
    (_platformName, segments) => {
      const expectedJoin = `join(versionDir, ${segments.map((segment) => JSON.stringify(segment)).join(", ")})`;
      expect(postinstallSource).toContain(expectedJoin);
    },
  );
});
