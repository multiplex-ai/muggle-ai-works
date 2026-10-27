export declare function buildElectronAppDirName(params: { version: string; releaseStream: string }): string;

export declare function isStreamInstall(params: { directoryName: string; releaseStream: string }): boolean;

export declare function isOutdatedStreamInstall(params: {
    directoryName: string;
    releaseStream: string;
    currentDirectoryName: string;
}): boolean;

export declare function shouldKeepVersionOverride(params: { overrideVersion: string; bundledVersion: string }): boolean;
