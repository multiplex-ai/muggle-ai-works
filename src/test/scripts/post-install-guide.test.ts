import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  POSIX_TERMINAL_DEVICE_PATH,
  POST_INSTALL_DOCS_URL,
  WINDOWS_TERMINAL_DEVICE_PATH,
  buildPostInstallGuide,
  showPostInstallGuide,
} from "../../../scripts/post-install-guide/index.mjs";

const packageManifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf-8"),
) as { files: string[] };

const postinstallSource = readFileSync(
  fileURLToPath(new URL("../../../scripts/postinstall.mjs", import.meta.url)),
  "utf-8",
);

function showWith(overrides: Partial<Parameters<typeof showPostInstallGuide>[0]>) {
  const writeToStdout = vi.fn();
  const writeToDevice = vi.fn();
  const result = showPostInstallGuide({
    guide: "the guide",
    isStdoutTerminal: false,
    env: {},
    platformName: "linux",
    writeToStdout: writeToStdout,
    writeToDevice: writeToDevice,
    ...overrides,
  });
  return { result, writeToStdout, writeToDevice };
}

describe("buildPostInstallGuide", () => {
  const guide = buildPostInstallGuide();

  it.each(["/mdo", "/mtest", "/mbt", "/m ", "muggle init", "muggle help", POST_INSTALL_DOCS_URL])(
    "mentions %s",
    (expected) => {
      expect(guide).toContain(expected);
    },
  );

  it("is plain text so it reads the same in the install log", () => {
    expect(guide).not.toContain("\x1b[");
  });
});

describe("showPostInstallGuide", () => {
  it("writes to stdout only when stdout is a terminal", () => {
    const { result, writeToStdout, writeToDevice } = showWith({ isStdoutTerminal: true });

    expect(writeToStdout).toHaveBeenCalledWith("the guide");
    expect(writeToDevice).not.toHaveBeenCalled();
    expect(result).toEqual({ wroteToStdout: true, wroteToTerminalDevice: false });
  });

  it("also writes to the POSIX console device when npm has captured stdout", () => {
    const { result, writeToDevice } = showWith({ platformName: "darwin" });

    expect(writeToDevice).toHaveBeenCalledWith(POSIX_TERMINAL_DEVICE_PATH, "\nthe guide\n\n");
    expect(result).toEqual({ wroteToStdout: true, wroteToTerminalDevice: true });
  });

  it("targets the Windows console device on win32", () => {
    const { writeToDevice } = showWith({ platformName: "win32" });

    expect(writeToDevice).toHaveBeenCalledWith(WINDOWS_TERMINAL_DEVICE_PATH, expect.any(String));
  });

  it("skips the console device in CI", () => {
    const { result, writeToDevice } = showWith({ env: { CI: "true" } });

    expect(writeToDevice).not.toHaveBeenCalled();
    expect(result.wroteToTerminalDevice).toBe(false);
  });

  it("swallows a console device that cannot be opened", () => {
    const writeToDevice = vi.fn(() => {
      throw new Error("ENXIO: no such device or address");
    });
    const { result, writeToStdout } = showWith({ writeToDevice: writeToDevice });

    expect(writeToStdout).toHaveBeenCalledWith("the guide");
    expect(result).toEqual({ wroteToStdout: true, wroteToTerminalDevice: false });
  });
});

describe("postinstall wiring", () => {
  it("shows the guide after the runner download settles", () => {
    expect(postinstallSource).toMatch(/downloadElectronApp\(\)[\s\S]*showPostInstallGuide\(/);
  });

  it("ships the guide module in the published package", () => {
    expect(packageManifest.files).toContain("scripts/post-install-guide");
  });
});
