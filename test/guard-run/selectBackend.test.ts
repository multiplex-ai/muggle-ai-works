import { describe, it, expect } from "vitest";
import { selectGuardRunBackend } from "../../src/guard-run/selectBackend.js";
import { GuardRunBackend } from "../../src/guard-run/types.js";

describe("selectGuardRunBackend", () => {
  it("win32 always uses the Job Object shim", () => {
    const selection = selectGuardRunBackend({
      platform: "win32",
      hasSystemdRun: false,
      systemdUserManagerState: null,
      hasPrlimit: false,
    });
    expect(selection.backend).toBe(GuardRunBackend.WindowsJobObject);
  });

  it("linux with a running systemd user manager uses a scope", () => {
    const selection = selectGuardRunBackend({
      platform: "linux",
      hasSystemdRun: true,
      systemdUserManagerState: "running",
      hasPrlimit: true,
    });
    expect(selection.backend).toBe(GuardRunBackend.LinuxSystemdScope);
  });

  it("linux with a degraded user manager still uses a scope", () => {
    const selection = selectGuardRunBackend({
      platform: "linux",
      hasSystemdRun: true,
      systemdUserManagerState: "degraded",
      hasPrlimit: false,
    });
    expect(selection.backend).toBe(GuardRunBackend.LinuxSystemdScope);
  });

  it.each([[null], ["offline"], ["failed"]])(
    "linux user-manager state %s falls back to prlimit",
    (managerState) => {
      const selection = selectGuardRunBackend({
        platform: "linux",
        hasSystemdRun: true,
        systemdUserManagerState: managerState,
        hasPrlimit: true,
      });
      expect(selection.backend).toBe(GuardRunBackend.LinuxPrlimitProcessGroup);
    },
  );

  it("linux without systemd-run falls back to prlimit", () => {
    const selection = selectGuardRunBackend({
      platform: "linux",
      hasSystemdRun: false,
      systemdUserManagerState: null,
      hasPrlimit: true,
    });
    expect(selection.backend).toBe(GuardRunBackend.LinuxPrlimitProcessGroup);
  });

  it("linux with no enforceable backend refuses — never silently unguarded", () => {
    const selection = selectGuardRunBackend({
      platform: "linux",
      hasSystemdRun: false,
      systemdUserManagerState: null,
      hasPrlimit: false,
    });
    expect(selection.backend).toBeNull();
    expect(selection.errorMessage).toContain("refusing to run the command unguarded");
  });

  it("darwin uses ulimit + process group", () => {
    const selection = selectGuardRunBackend({
      platform: "darwin",
      hasSystemdRun: false,
      systemdUserManagerState: null,
      hasPrlimit: false,
    });
    expect(selection.backend).toBe(GuardRunBackend.DarwinUlimitProcessGroup);
  });

  it("an unknown platform refuses", () => {
    const selection = selectGuardRunBackend({
      platform: "aix",
      hasSystemdRun: false,
      systemdUserManagerState: null,
      hasPrlimit: false,
    });
    expect(selection.backend).toBeNull();
    expect(selection.errorMessage).toContain('unsupported platform "aix"');
  });
});
