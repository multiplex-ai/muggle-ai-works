/**
 * Runtime target model for @muggleai/works.
 */

/** Named backend environment a harness build points at. */
export enum RuntimeTarget {
  Production = "production",
  Staging = "staging",
  Dev = "dev",
}

/**
 * Named electron-app release stream.
 *
 * Distinct from RuntimeTarget because streams and targets are not one-to-one:
 * dev and production share a stream, since a dev build talks to a local backend
 * with the production studio.
 */
export enum ElectronAppReleaseStream {
  Production = "production",
  Staging = "staging",
}

/** Where one electron-app release stream publishes. */
export interface IElectronAppReleaseStreamProfile {
  /** Release tag prefix identifying this stream's releases. */
  electronAppReleaseTagPrefix: string;
}

/** Every setting that moves together when the runtime target changes. */
export interface IRuntimeTargetProfile {
  /** Base URL of the prompt service backend for this target. */
  promptServiceBaseUrl: string;
  /** Auth0 domain used for the device code login flow. */
  auth0Domain: string;
  /** Auth0 client ID for the device code grant. Empty when the target has no provisioned client. */
  auth0ClientId: string;
  /** Auth0 API audience requested alongside the device code grant. */
  auth0Audience: string;
  /** Electron-app release stream this target installs its studio from. */
  electronAppReleaseStream: ElectronAppReleaseStream;
}
