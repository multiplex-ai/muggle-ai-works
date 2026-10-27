export declare function normalizeInstallDirectoryName(directoryName: string): string;

export declare function findInstallDirectoryNamesInProcessPaths(params: {
    appDir: string;
    processPaths: string[];
    isCaseInsensitive: boolean;
}): Set<string>;

export declare function listRunningInstallDirectoryNames(params: { appDir: string }): Set<string> | null;
