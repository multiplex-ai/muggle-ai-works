export declare function buildElectronAppDirName(params: { version: string; releaseStream: string }): string;

export declare function isOutdatedStreamInstall(params: {
    directoryName: string;
    releaseStream: string;
    currentDirectoryName: string;
}): boolean;
