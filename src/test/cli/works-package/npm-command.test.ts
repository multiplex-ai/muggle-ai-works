import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ExecFileCallback = (error: (Error & { code?: number | string }) | null, stdout?: string, stderr?: string) => void;

const childProcessMock = vi.hoisted(() => ({ execFile: vi.fn() }));
const osMock = vi.hoisted(() => ({ platform: vi.fn(() => "linux") }));

vi.mock("child_process", () => childProcessMock);
vi.mock("os", async (importOriginal) => ({ ...(await importOriginal<typeof import("os")>()), platform: osMock.platform }));

import { NPM_COMMANDS_ENV } from "../../../cli/works-package/constants.js";
import { runNpmCommand } from "../../../cli/works-package/npm-command.js";

const LOOKUP_ARGUMENTS = ["view", "@muggleai/works", "dist-tags.staging"];
const TIMEOUT_MS = 1_000;

function answerExecFile(error: (Error & { code?: number | string }) | null, stdout?: string, stderr?: string): void {
  childProcessMock.execFile.mockImplementation(
    (_executable: string, _arguments: string[], _options: object, callback: ExecFileCallback) => callback(error, stdout, stderr),
  );
}

describe("runNpmCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv(NPM_COMMANDS_ENV, "");
    osMock.platform.mockReturnValue("linux");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts npm directly off Windows, with no console window and the timeout given", async () => {
    answerExecFile(null, "5.39.0-staging.369\n", "");

    const outcome = await runNpmCommand(LOOKUP_ARGUMENTS, TIMEOUT_MS);

    expect(outcome).toEqual({ exitCode: 0, stdout: "5.39.0-staging.369\n", stderr: "" });
    const [executable, executableArguments, options] = childProcessMock.execFile.mock.calls[0];
    expect(executable).toBe("npm");
    expect(executableArguments).toEqual(LOOKUP_ARGUMENTS);
    expect(options).toMatchObject({ windowsHide: true, timeout: TIMEOUT_MS });
  });

  it("starts npm through cmd.exe on Windows, where npm is a .cmd shim", async () => {
    osMock.platform.mockReturnValue("win32");
    answerExecFile(null, "", "");

    await runNpmCommand(LOOKUP_ARGUMENTS, TIMEOUT_MS);

    const [executable, executableArguments, options] = childProcessMock.execFile.mock.calls[0];
    expect(executable).toBe("cmd.exe");
    expect(executableArguments).toEqual(["/d", "/s", "/c", "npm", ...LOOKUP_ARGUMENTS]);
    expect(options).toMatchObject({ windowsHide: true });
  });

  it("keeps npm's output when it exits non-zero", async () => {
    answerExecFile(Object.assign(new Error("exited"), { code: 1 }), "", "npm error code EPERM");

    expect(await runNpmCommand(["install", "-g", "@muggleai/works@staging"], TIMEOUT_MS)).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "npm error code EPERM",
    });
  });

  it("resolves undefined when npm cannot be started", async () => {
    answerExecFile(Object.assign(new Error("spawn npm ENOENT"), { code: "ENOENT" }));

    expect(await runNpmCommand(LOOKUP_ARGUMENTS, TIMEOUT_MS)).toBeUndefined();
  });

  it("resolves undefined when npm is killed at its timeout", async () => {
    answerExecFile(Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" }));

    expect(await runNpmCommand(LOOKUP_ARGUMENTS, TIMEOUT_MS)).toBeUndefined();
  });

  it("starts nothing when npm commands are switched off", async () => {
    vi.stubEnv(NPM_COMMANDS_ENV, "off");

    expect(await runNpmCommand(LOOKUP_ARGUMENTS, TIMEOUT_MS)).toBeUndefined();
    expect(childProcessMock.execFile).not.toHaveBeenCalled();
  });
});
