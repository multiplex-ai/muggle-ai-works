import { describe, it, expect } from "vitest";
import { resolveSkipDeclaration } from "../../e2e-skip/resolveSkip";
import { E2eSkipCode, SkipRejection, type SkipProbes, type SkipVerificationContext } from "../../e2e-skip/types";

interface Environment {
  files?: Record<string, string>;
  dirs?: Record<string, string[]>;
  git?: Record<string, string>;
  reachable?: string[];
}

const contextFor = (environment: Environment, overrides: Partial<SkipVerificationContext> = {}) => {
  const probe: SkipProbes = {
    readTextFile: (path) => environment.files?.[path.replace(/\\/g, "/")] ?? null,
    listFiles: (dir) => environment.dirs?.[dir.replace(/\\/g, "/")] ?? [],
    runGit: (args) => environment.git?.[args.join(" ")] ?? null,
    isReachable: (url) => (environment.reachable ?? []).includes(url),
  };
  return { cwd: "/repo", prsHandled: [], homeDir: "/home", probe: probe, ...overrides };
};

const declare = (code: string, detail = "") =>
  `echo "MUGGLE_E2E_SKIP: ${code}${detail ? `: ${detail}` : ""}"`;

describe("NO_WEB_SURFACE", () => {
  it("verifies when the repo declares no serving script and carries no web config", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.NoWebSurface, "hooks and a CLI only"),
      contextFor({ files: { "/repo/package.json": '{"scripts":{"test":"vitest"}}' } }),
    );
    expect(judged?.accepted).toBe(true);
  });

  it("refutes when a script actually runs a web server", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.NoWebSurface),
      contextFor({ files: { "/repo/package.json": '{"scripts":{"dev":"vite"}}' } }),
    );
    expect(judged).toMatchObject({ accepted: false, rejection: SkipRejection.VerificationFailed });
  });

  // A CLI or MCP server declares `dev` too. Refusing a skip on the mere name
  // would refuse honest work, which is how a guard earns a workaround.
  it("verifies despite a dev script that runs no web server", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.NoWebSurface),
      contextFor({
        files: {
          "/repo/package.json": '{"scripts":{"dev":"tsx watch src/index.ts","start":"node dist/index.js"}}',
        },
      }),
    );
    expect(judged?.accepted).toBe(true);
  });

  it("refutes when a browser framework is a declared dependency", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.NoWebSurface),
      contextFor({ files: { "/repo/package.json": '{"dependencies":{"react-dom":"^18.0.0"}}' } }),
    );
    expect(judged?.accepted).toBe(false);
  });

  it("refutes when an index.html exists without a dev script", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.NoWebSurface),
      contextFor({ files: { "/repo/package.json": "{}", "/repo/index.html": "<html></html>" } }),
    );
    expect(judged?.accepted).toBe(false);
  });
});

describe("DEV_SERVER_UNREACHABLE", () => {
  it("verifies when the named url does not answer", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.DevServerUnreachable, "http://localhost:3000 refused"),
      contextFor({ reachable: [] }),
    );
    expect(judged?.accepted).toBe(true);
  });

  it("refutes when the named url answers", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.DevServerUnreachable, "http://localhost:3000 refused"),
      contextFor({ reachable: ["http://localhost:3000"] }),
    );
    expect(judged?.accepted).toBe(false);
  });

  it("refutes when the detail names no url to probe", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.DevServerUnreachable, "the server was down"),
      contextFor({}),
    );
    expect(judged?.accepted).toBe(false);
  });
});

describe("EMPTY_DIFF", () => {
  const base = { "symbolic-ref refs/remotes/origin/HEAD --short": "origin/master\n" };

  it("verifies when the branch carries no diff against its base", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.EmptyDiff),
      contextFor({ git: { ...base, "diff origin/master...HEAD --stat": "\n" } }),
    );
    expect(judged?.accepted).toBe(true);
  });

  it("refutes when the branch carries a diff", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.EmptyDiff),
      contextFor({ git: { ...base, "diff origin/master...HEAD --stat": " src/app.ts | 2 +-\n" } }),
    );
    expect(judged?.accepted).toBe(false);
  });
});

describe("MUGGLE_AUTH_DOWN", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();

  it("verifies when no session file exists", () => {
    expect(resolveSkipDeclaration(declare(E2eSkipCode.MuggleAuthDown), contextFor({}))?.accepted).toBe(true);
  });

  it("verifies when every stored session has expired", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.MuggleAuthDown),
      contextFor({
        dirs: { "/home/.muggle-ai": ["oauth-session.json"] },
        files: { "/home/.muggle-ai/oauth-session.json": JSON.stringify({ expiresAt: past }) },
      }),
    );
    expect(judged?.accepted).toBe(true);
  });

  // The live session may sit under any runtime target's file, so a valid one
  // anywhere refutes the claim.
  it("refutes when a non-default ring still holds a valid session", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.MuggleAuthDown),
      contextFor({
        dirs: { "/home/.muggle-ai": ["oauth-session.json", "oauth-session-staging.json"] },
        files: {
          "/home/.muggle-ai/oauth-session.json": JSON.stringify({ expiresAt: past }),
          "/home/.muggle-ai/oauth-session-staging.json": JSON.stringify({ expiresAt: future }),
        },
      }),
    );
    expect(judged?.accepted).toBe(false);
  });
});

describe("NO_PR", () => {
  it("verifies when the session handled no pull request", () => {
    expect(resolveSkipDeclaration(declare(E2eSkipCode.NoPr), contextFor({}))?.accepted).toBe(true);
  });

  it("refutes when the session handled one", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.NoPr),
      contextFor({}, { prsHandled: ["https://github.com/o/r/pull/1"] }),
    );
    expect(judged?.accepted).toBe(false);
  });
});

describe("USER_WAIVED", () => {
  const userTurn = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: text } });

  it("verifies when a user turn carries the literal waive", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.UserWaived),
      contextFor(
        { files: { "/t.jsonl": userTurn("just ship it, SKIP E2E this once") } },
        { transcriptPath: "/t.jsonl" },
      ),
    );
    expect(judged?.accepted).toBe(true);
  });

  // The agent quoting the phrase back to itself is not the user saying it.
  it("refutes when only the assistant used the phrase", () => {
    const assistantTurn = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: "I could SKIP E2E here" },
    });
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.UserWaived),
      contextFor({ files: { "/t.jsonl": assistantTurn } }, { transcriptPath: "/t.jsonl" }),
    );
    expect(judged?.accepted).toBe(false);
  });

  it("refutes when the user was merely impatient", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.UserWaived),
      contextFor(
        { files: { "/t.jsonl": userTurn("this is taking forever, just finish") } },
        { transcriptPath: "/t.jsonl" },
      ),
    );
    expect(judged?.accepted).toBe(false);
  });
});
