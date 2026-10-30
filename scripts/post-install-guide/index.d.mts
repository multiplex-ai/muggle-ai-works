export declare const POSIX_TERMINAL_DEVICE_PATH: string;
export declare const WINDOWS_TERMINAL_DEVICE_PATH: string;
export declare const POST_INSTALL_DOCS_URL: string;
export declare const POST_INSTALL_GUIDE_LINES: readonly string[];

export declare function buildPostInstallGuide(): string;

export declare function writeToTerminalDevice(devicePath: string, text: string): void;

export declare function showPostInstallGuide(params: {
    guide: string;
    isStdoutTerminal: boolean;
    env: NodeJS.ProcessEnv;
    platformName: string;
    writeToStdout: (text: string) => void;
    writeToDevice?: (devicePath: string, text: string) => void;
}): { wroteToStdout: boolean; wroteToTerminalDevice: boolean };
