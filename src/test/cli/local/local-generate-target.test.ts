import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getActiveElectronAppReleaseStream,
  getActiveRuntimeTarget,
  getConfig,
  resetConfig,
} from "../../../../packages/mcps/src/shared/config.js";
import { RUNTIME_TARGET_ENV_VAR } from "../../../../packages/mcps/src/shared/runtime-target-constants.js";
import { ElectronAppReleaseStream, RuntimeTarget } from "../../../../packages/mcps/src/shared/runtime-target-types.js";

afterEach(() => {
  delete process.env[RUNTIME_TARGET_ENV_VAR];
  resetConfig();
});

describe("muggle generate --local target selection", () => {
  it("runs a production target on the production session, backend and studio stream", () => {
    process.env[RUNTIME_TARGET_ENV_VAR] = RuntimeTarget.Production;
    resetConfig();

    expect(getActiveRuntimeTarget()).toBe(RuntimeTarget.Production);
    expect(path.basename(getConfig().localQa.oauthSessionFilePath)).toBe("oauth-session.json");
    expect(getConfig().localQa.promptServiceUrl).toBe("https://promptservice.muggle-ai.com");
    expect(getActiveElectronAppReleaseStream()).toBe(ElectronAppReleaseStream.Production);
  });

  it("keeps a staging target on its own session and studio stream", () => {
    process.env[RUNTIME_TARGET_ENV_VAR] = RuntimeTarget.Staging;
    resetConfig();

    expect(path.basename(getConfig().localQa.oauthSessionFilePath)).toBe("oauth-session-staging.json");
    expect(getActiveElectronAppReleaseStream()).toBe(ElectronAppReleaseStream.Staging);
  });
});
