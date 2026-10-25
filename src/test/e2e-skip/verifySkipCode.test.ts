import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { defaultSkipProbes } from "../../e2e-skip/probes";
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

describe("NO_APP_LOGIC_CHANGE", () => {
  const PRE_CYCLE = "1a2b3c4";
  const changed = (...paths: string[]) => ({
    [`diff --name-only --no-renames -z ${PRE_CYCLE}^{commit} HEAD`]: paths.map((path) => `${path}\0`).join(""),
  });
  const declareSince = (reason: string) => declare(E2eSkipCode.NoAppLogicChange, `${PRE_CYCLE} ${reason}`);

  it("verifies a cycle that changed only docs", () => {
    const judged = resolveSkipDeclaration(
      declareSince("README typo"),
      contextFor({ git: changed("README.md", "docs/guide/setup.md") }),
    );
    expect(judged).toEqual({
      accepted: true,
      skip: { code: E2eSkipCode.NoAppLogicChange, detail: `${PRE_CYCLE} README typo` },
    });
  });

  it("verifies tests, lint/format config, and CI config", () => {
    const judged = resolveSkipDeclaration(
      declareSince("test rename, lint and CI tweaks"),
      contextFor({
        git: changed(
          "src/cart/cart.test.ts",
          "src/__tests__/checkout.tsx",
          "tests/conftest.py",
          ".eslintrc.json",
          "eslint.config.mjs",
          ".prettierrc",
          ".github/workflows/ci.yml",
        ),
      }),
    );
    expect(judged?.accepted).toBe(true);
  });

  it("refutes a cycle that changed a source file", () => {
    const judged = resolveSkipDeclaration(declareSince("renamed a helper"), contextFor({ git: changed("src/app.ts") }));
    expect(judged).toMatchObject({
      accepted: false,
      rejection: SkipRejection.VerificationFailed,
      claimedCode: E2eSkipCode.NoAppLogicChange,
    });
    expect(judged?.accepted === false && judged.failure).toContain("src/app.ts");
  });

  // Conservative by design: a path rule is what makes the skip verifiable, so
  // the guardrail never reads the diff's content to excuse a source file.
  it("refutes a comment-only edit in a source file", () => {
    const judged = resolveSkipDeclaration(
      declareSince("only a code comment changed"),
      contextFor({ git: changed("src/checkout/total.ts") }),
    );
    expect(judged?.accepted).toBe(false);
  });

  it("refutes a mix of docs and source, naming only the source path", () => {
    const judged = resolveSkipDeclaration(
      declareSince("docs and a fix"),
      contextFor({ git: changed("README.md", "src/app.ts") }),
    );
    expect(judged?.accepted).toBe(false);
    const failure = judged?.accepted === false ? judged.failure : "";
    expect(failure).toContain("src/app.ts");
    expect(failure).not.toContain("README.md");
  });

  it("refutes MDX and nested test folders, which can render as pages", () => {
    expect(resolveSkipDeclaration(declareSince("copy"), contextFor({ git: changed("app/about.mdx") }))?.accepted).toBe(false);
    expect(
      resolveSkipDeclaration(declareSince("route"), contextFor({ git: changed("app/test/page.tsx") }))?.accepted,
    ).toBe(false);
  });

  it("refutes a SHA that resolves to no commit", () => {
    const judged = resolveSkipDeclaration(declareSince("docs"), contextFor({ git: {} }));
    expect(judged?.accepted === false && judged.failure).toContain("does not resolve to a commit");
  });

  it("refutes a detail that opens with no SHA", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.NoAppLogicChange, "docs and tests only"),
      contextFor({ git: changed("README.md") }),
    );
    expect(judged?.accepted === false && judged.failure).toContain("names no pre-cycle commit");
  });

  it("refutes an empty diff, which means the cycle's commits are not on HEAD", () => {
    const judged = resolveSkipDeclaration(declareSince("docs"), contextFor({ git: changed() }));
    expect(judged?.accepted === false && judged.failure).toContain("carries no change");
  });

  it("names the first offending paths and counts the rest", () => {
    const sources = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts"].map((name) => `src/${name}`);
    const judged = resolveSkipDeclaration(declareSince("big"), contextFor({ git: changed(...sources) }));
    const failure = judged?.accepted === false ? judged.failure : "";
    expect(failure).toContain("src/e.ts and 2 more");
    expect(failure).not.toContain("src/f.ts");
  });

  // Pins the real git invocations the fakes above stand in for: the `^{commit}`
  // peel, two-tree diff, and NUL-separated names.
  it("verifies and refutes against a real repository", () => {
    const repo = mkdtempSync(join(tmpdir(), "no-app-logic-"));
    const git = (...args: string[]): string =>
      execFileSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: repo,
          USERPROFILE: repo,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@example.com",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.com",
        },
      });
    git("init", "-q");
    writeFileSync(join(repo, "app.ts"), "export const total = 1;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "app");
    const preCycleSha = git("rev-parse", "--short", "HEAD").trim();
    writeFileSync(join(repo, "README.md"), "# docs\n");
    git("add", "-A");
    git("commit", "-q", "-m", "docs");
    const context = { cwd: repo, prsHandled: [], homeDir: repo, probe: defaultSkipProbes };

    expect(resolveSkipDeclaration(declare(E2eSkipCode.NoAppLogicChange, `${preCycleSha} docs`), context)?.accepted).toBe(true);
    const unknownSha = resolveSkipDeclaration(declare(E2eSkipCode.NoAppLogicChange, "deadbeef0 docs"), context);
    expect(unknownSha?.accepted === false && unknownSha.failure).toContain("does not resolve to a commit");

    writeFileSync(join(repo, "app.ts"), "// a comment only\nexport const total = 1;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "comment");
    const judged = resolveSkipDeclaration(declare(E2eSkipCode.NoAppLogicChange, `${preCycleSha} docs`), context);
    expect(judged?.accepted === false && judged.failure).toContain("app.ts");
  });
});

describe("NOT_APPLICABLE", () => {
  it("accepts a stated reason, whatever the environment", () => {
    const judged = resolveSkipDeclaration(
      declare(E2eSkipCode.NotApplicable, "only the transactional email template changed"),
      contextFor({}, { cwd: undefined }),
    );
    expect(judged).toEqual({
      accepted: true,
      skip: { code: E2eSkipCode.NotApplicable, detail: "only the transactional email template changed" },
    });
  });

  it.each([
    ["no reason", ""],
    ["a bare label", "backend only"],
  ])("refutes %s", (_label, detail) => {
    const judged = resolveSkipDeclaration(declare(E2eSkipCode.NotApplicable, detail), contextFor({}));
    expect(judged?.accepted).toBe(false);
    expect(judged?.accepted === false && judged.rejection).toBe(SkipRejection.VerificationFailed);
    expect(judged?.accepted === false && judged.failure).toContain("NOT_APPLICABLE: <why");
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
