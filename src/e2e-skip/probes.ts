import { execFileSync } from "child_process";
import { readFileSync, readdirSync } from "fs";
import { DEV_SERVER_PROBE_TIMEOUT_MS } from "./constants.js";
import type { SkipProbes } from "./types.js";

const readTextFile = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

const listFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

const runGit = (args: string[], cwd: string): string | null => {
  try {
    return execFileSync("git", args, { cwd: cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};

const hostAndPort = (url: string): { host: string; port: number } | null => {
  const withScheme = /^https?:\/\//i.test(url) ? url : `http://${url}`;
  try {
    const parsed = new URL(withScheme);
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
    return { host: parsed.hostname, port: port };
  } catch {
    return null;
  }
};

// A guardrail runs synchronously inside a tool call, so the probe is a short
// child `node` rather than an awaited socket: the parent gets a verdict from an
// exit code without the hook becoming async, and a hung host is bounded twice —
// by the socket timeout and by the spawn timeout around it.
const isReachable = (url: string): boolean => {
  const target = hostAndPort(url);
  if (!target) return false;
  const script =
    "const net=require('net');" +
    `const s=net.connect(${target.port},${JSON.stringify(target.host)});` +
    `s.setTimeout(${DEV_SERVER_PROBE_TIMEOUT_MS});` +
    "s.on('connect',()=>{s.destroy();process.exit(0)});" +
    "s.on('timeout',()=>{s.destroy();process.exit(1)});" +
    "s.on('error',()=>process.exit(1));";
  try {
    execFileSync(process.execPath, ["-e", script], {
      timeout: DEV_SERVER_PROBE_TIMEOUT_MS * 2,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

/** The real environment lookups, injected into verifiers so tests never touch a repo, a socket, or a home directory. */
export const defaultSkipProbes: SkipProbes = {
  readTextFile: readTextFile,
  listFiles: listFiles,
  runGit: runGit,
  isReachable: isReachable,
};
