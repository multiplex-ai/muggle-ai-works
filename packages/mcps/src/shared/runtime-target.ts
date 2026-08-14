/**
 * Runtime target resolution for @muggleai/works.
 */

import {
  RUNTIME_TARGET_ENV_VAR,
  getElectronAppReleaseStreams,
  getRuntimeTargetProfiles,
} from "./runtime-target-constants.js";
import {
  ElectronAppReleaseStream,
  RuntimeTarget,
  type IRuntimeTargetProfile,
} from "./runtime-target-types.js";

/** Every runtime target name, in the order they are offered in error messages. */
const KNOWN_RUNTIME_TARGETS: RuntimeTarget[] = [
  RuntimeTarget.Production,
  RuntimeTarget.Staging,
  RuntimeTarget.Dev,
];

/**
 * Resolve the active runtime target.
 *
 * Priority: the environment override, then the target baked into the package
 * at publish time, then dev.
 * @param bakedDefault - Target baked into package.json, when present.
 * @returns The resolved runtime target.
 * @throws Error when the environment override names an unknown target.
 */
export function resolveRuntimeTarget(bakedDefault?: RuntimeTarget): RuntimeTarget {
  const overrideValue = process.env[RUNTIME_TARGET_ENV_VAR];

  if (overrideValue) {
    const matchedTarget = KNOWN_RUNTIME_TARGETS.find((target) => target === overrideValue);
    if (!matchedTarget) {
      throw new Error(
        `Invalid ${RUNTIME_TARGET_ENV_VAR} value: '${overrideValue}'. ` +
          `Expected one of: ${KNOWN_RUNTIME_TARGETS.join(", ")}.`,
      );
    }
    return matchedTarget;
  }

  return bakedDefault ?? RuntimeTarget.Dev;
}

/**
 * Resolve the configuration profile for the active runtime target.
 * @param bakedDefault - Target baked into package.json, when present.
 * @returns The active target's profile.
 */
export function resolveActiveProfile(bakedDefault?: RuntimeTarget): IRuntimeTargetProfile {
  return getRuntimeTargetProfiles()[resolveRuntimeTarget(bakedDefault)];
}

/**
 * Resolve the electron-app release stream the active target installs from.
 * @param bakedDefault - Target baked into package.json, when present.
 * @returns The active target's release stream.
 */
export function resolveActiveReleaseStream(bakedDefault?: RuntimeTarget): ElectronAppReleaseStream {
  return resolveActiveProfile(bakedDefault).electronAppReleaseStream;
}

/**
 * Resolve the release tag prefix the active target installs its studio from.
 * @param bakedDefault - Target baked into package.json, when present.
 * @returns Release tag prefix, for example "electron-app-v".
 */
export function resolveActiveReleaseTagPrefix(bakedDefault?: RuntimeTarget): string {
  return getElectronAppReleaseStreams()[resolveActiveReleaseStream(bakedDefault)]
    .electronAppReleaseTagPrefix;
}

/**
 * Assert that a target can run the device code login flow.
 * @param target - Runtime target to check.
 * @throws Error when the target has no Auth0 device code client provisioned.
 */
export function assertDeviceCodeClientProvisioned(target: RuntimeTarget): void {
  // An empty client ID reaches Auth0 as a malformed device-code request and
  // comes back as an opaque 403; naming the target is what makes it fixable.
  if (getRuntimeTargetProfiles()[target].auth0ClientId === "") {
    throw new Error(
      `Runtime target '${target}' has no Auth0 device code client provisioned. ` +
        `Provision a native application with the device code grant in that tenant, ` +
        `then record its client ID in RUNTIME_TARGET_PROFILES.`,
    );
  }
}
