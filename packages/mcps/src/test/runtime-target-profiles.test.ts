import { describe, expect, it } from "vitest";

import {
  getElectronAppReleaseStreams,
  getRuntimeTargetProfiles,
} from "../shared/runtime-target-constants.js";
import { ElectronAppReleaseStream, RuntimeTarget } from "../shared/runtime-target-types.js";

const runtimeTargetProfiles = getRuntimeTargetProfiles();
const releaseStreams = getElectronAppReleaseStreams();

describe("runtime target profiles", () => {
  it("covers every runtime target", () => {
    expect(Object.keys(runtimeTargetProfiles).sort()).toEqual(
      [RuntimeTarget.Dev, RuntimeTarget.Production, RuntimeTarget.Staging].sort(),
    );
  });

  it("points production at the production prompt service and tenant", () => {
    const productionProfile = runtimeTargetProfiles[RuntimeTarget.Production];
    expect(productionProfile.promptServiceBaseUrl).toBe("https://promptservice.muggle-ai.com");
    expect(productionProfile.auth0Domain).toBe("login.muggle-ai.com");
    expect(productionProfile.auth0ClientId).toBe("UgG5UjoyLksxMciWWKqVpwfWrJ4rFvtT");
  });

  it("points staging at the staging prompt service and tenant", () => {
    const stagingProfile = runtimeTargetProfiles[RuntimeTarget.Staging];
    expect(stagingProfile.promptServiceBaseUrl).toBe("https://staging.promptservice.muggle-ai.com");
    expect(stagingProfile.auth0Domain).toBe("login.staging.muggle-ai.com");
    expect(stagingProfile.auth0Audience).toBe("https://staging-muggleai.us.auth0.com/api/v2/");
  });

  it("gives staging its own studio release stream", () => {
    expect(runtimeTargetProfiles[RuntimeTarget.Staging].electronAppReleaseStream).toBe(
      ElectronAppReleaseStream.Staging,
    );
    expect(runtimeTargetProfiles[RuntimeTarget.Production].electronAppReleaseStream).toBe(
      ElectronAppReleaseStream.Production,
    );
  });

  it("keeps dev on the production studio stream", () => {
    expect(runtimeTargetProfiles[RuntimeTarget.Dev].promptServiceBaseUrl).toBe("http://localhost:5050");
    expect(runtimeTargetProfiles[RuntimeTarget.Dev].electronAppReleaseStream).toBe(
      ElectronAppReleaseStream.Production,
    );
  });
});

describe("electron-app release streams", () => {
  it("covers every release stream", () => {
    expect(Object.keys(releaseStreams).sort()).toEqual(
      [ElectronAppReleaseStream.Production, ElectronAppReleaseStream.Staging].sort(),
    );
  });

  it("gives each stream a distinct release tag prefix", () => {
    expect(releaseStreams[ElectronAppReleaseStream.Production].electronAppReleaseTagPrefix).toBe(
      "electron-app-v",
    );
    expect(releaseStreams[ElectronAppReleaseStream.Staging].electronAppReleaseTagPrefix).toBe(
      "electron-app-staging-v",
    );
  });

  it("references only streams that exist from every target", () => {
    for (const profile of Object.values(runtimeTargetProfiles)) {
      expect(releaseStreams[profile.electronAppReleaseStream]).toBeDefined();
    }
  });
});
