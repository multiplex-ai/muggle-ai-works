import type { ElectronAppReleaseStream } from "./runtime-target-types.js";

/** Version and release stream an electron-app install directory name encodes. */
export interface IElectronAppInstallDirName {
  /** Electron app version, for example "1.13.9". */
  version: string;
  /** Release stream the install belongs to. */
  releaseStream: ElectronAppReleaseStream;
}
