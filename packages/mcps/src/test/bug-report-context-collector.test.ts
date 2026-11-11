import { beforeEach, describe, expect, it, vi } from "vitest";

const harnessSources = vi.hoisted(() => ({
  lastProject: null as { projectId: string } | null,
  runResults: [] as Array<{ id: string; status: string }>,
  studioVersionError: null as Error | null,
  runResultsError: null as Error | null,
}));

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({ serverVersion: "5.35.0" }),
  getElectronAppVersion: () => {
    if (harnessSources.studioVersionError) throw harnessSources.studioVersionError;
    return "1.25.0";
  },
  getActiveElectronAppReleaseStream: () => "staging",
}));

vi.mock("../shared/logger.js", () => {
  const noop = () => undefined;
  const fakeLogger = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, silly: noop, child: () => fakeLogger };
  return { getLogger: () => fakeLogger, createChildLogger: () => fakeLogger, resetLogger: noop };
});

vi.mock("../shared/last-project.js", () => ({
  readLastProject: () => harnessSources.lastProject,
}));

vi.mock("../mcp/local/services/run-result-storage-service.js", () => ({
  getRunResultStorageService: () => ({
    listRunResults: () => {
      if (harnessSources.runResultsError) throw harnessSources.runResultsError;
      return harnessSources.runResults;
    },
  }),
}));

import { collectBugReportClientContext } from "../mcp/local/services/bug-report-context.js";

beforeEach(() => {
  harnessSources.lastProject = null;
  harnessSources.runResults = [];
  harnessSources.studioVersionError = null;
  harnessSources.runResultsError = null;
});

describe("collectBugReportClientContext", () => {
  it("gathers versions, operating system, last project and the newest local run", () => {
    harnessSources.lastProject = { projectId: "11111111-1111-4111-8111-111111111111" };
    harnessSources.runResults = [
      { id: "22222222-2222-4222-8222-222222222222", status: "failed" },
      { id: "33333333-3333-4333-8333-333333333333", status: "passed" },
    ];

    const sanitizedContext = collectBugReportClientContext({ cwd: "/work/app" });

    expect(sanitizedContext.clientContext).toEqual({
      cliVersion: "5.35.0",
      studioVersion: "1.25.0-staging",
      os: expect.any(String),
      lastProjectId: "11111111-1111-4111-8111-111111111111",
      lastLocalRunId: "22222222-2222-4222-8222-222222222222",
      lastLocalRunStatus: "failed",
    });
    expect(sanitizedContext.strippedFieldNames).toEqual([]);
  });

  it("leaves out the last project and run when neither file exists", () => {
    const sanitizedContext = collectBugReportClientContext({ cwd: "/work/app" });

    expect(Object.keys(sanitizedContext.clientContext).sort()).toEqual(["cliVersion", "os", "studioVersion"]);
  });

  it("leaves out a source that fails to read and keeps the rest", () => {
    harnessSources.studioVersionError = new Error("muggleConfig missing");
    harnessSources.runResultsError = new Error("EACCES");

    const sanitizedContext = collectBugReportClientContext({ cwd: "/work/app" });

    expect(sanitizedContext.clientContext.studioVersion).toBeUndefined();
    expect(sanitizedContext.clientContext.lastLocalRunId).toBeUndefined();
    expect(sanitizedContext.clientContext.cliVersion).toBe("5.35.0");
  });

  it("strips a secret-looking value read from disk", () => {
    harnessSources.lastProject = { projectId: "api_key=abc123" };

    const sanitizedContext = collectBugReportClientContext({ cwd: "/work/app" });

    expect(sanitizedContext.clientContext.lastProjectId).toBeUndefined();
    expect(sanitizedContext.strippedFieldNames).toEqual(["lastProjectId"]);
  });
});
