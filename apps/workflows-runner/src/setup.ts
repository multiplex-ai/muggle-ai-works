/**
 * Runner setup: ensures credentials, prompts for project, and configures repos.
 *
 * - Muggle API key: read from ~/.muggle-ai/credentials.json (written by `muggle login`).
 *   If missing, triggers the device-code login flow to create and cache one.
 * - Anthropic API key: not managed here — the SDK reads ANTHROPIC_API_KEY from env.
 * - Project ID: always prompted each run (projects change frequently).
 * - Repos: prompted once on first run, cached in ~/.muggle-ai/runner-config.json.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';

import axios from 'axios';
import { performLogin } from '@muggleai/mcp';

import type { RepoConfig } from '@muggleai/workflows';

import { loadRunnerConfig, saveRunnerConfig } from './runner-config.js';

// ---------------------------------------------------------------------------
// Readline helpers
// ---------------------------------------------------------------------------

function createRL(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

// ---------------------------------------------------------------------------
// Muggle API key
// ---------------------------------------------------------------------------

interface RawCredentials {
  apiKey?: string;
}

function readCachedApiKey(): string | undefined {
  const credPath = path.join(os.homedir(), '.muggle-ai', 'credentials.json');
  try {
    if (!fs.existsSync(credPath)) return undefined;
    const raw = JSON.parse(fs.readFileSync(credPath, 'utf-8')) as RawCredentials;
    return raw.apiKey ?? undefined;
  } catch {
    return undefined;
  }
}

async function ensureMuggleApiKey(rl: readline.Interface): Promise<string> {
  const cached = readCachedApiKey();
  if (cached) return cached;

  console.log('\nNo Muggle credentials found. Starting login…');
  console.log('A browser window will open — complete the login there.\n');

  const result = await performLogin(/* keyName */ 'dev-cycle-runner', /* expiry */ '1y');
  if (!result.success || !result.credentials?.apiKey) {
    throw new Error(`Login failed: ${result.error ?? 'unknown error'}`);
  }

  // performLogin already saves credentials to disk via saveCredentials()
  console.log('Login successful.\n');
  return result.credentials.apiKey;
}

// ---------------------------------------------------------------------------
// Project selection (always prompted — projects change)
// ---------------------------------------------------------------------------

interface ProjectItem {
  id: string;
  name: string;
}

async function fetchProjects(apiKey: string): Promise<ProjectItem[]> {
  const base = process.env['MUGGLE_API_URL'] ?? 'https://api.muggle-ai.com';
  try {
    const res = await axios.get<ProjectItem[]>(
      `${base}/v1/protected/muggle-test/projects`,
      { headers: { 'x-api-key': apiKey } },
    );
    return res.data;
  } catch {
    return [];
  }
}

async function promptProjectId(rl: readline.Interface, apiKey: string): Promise<string> {
  console.log('Fetching your projects…');
  const projects = await fetchProjects(apiKey);

  if (projects.length === 0) {
    const id = (await ask(rl, 'No projects found. Enter your project ID: ')).trim();
    if (!id) throw new Error('A project ID is required.');
    return id;
  }

  if (projects.length === 1) {
    console.log(`Project: ${projects[0]!.name}  (${projects[0]!.id})\n`);
    return projects[0]!.id;
  }

  console.log('\nAvailable projects:');
  projects.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}  (${p.id})`));
  const pick = (await ask(rl, `Select project [1-${projects.length}]: `)).trim();
  const chosen = projects[parseInt(pick, 10) - 1];
  if (!chosen) throw new Error('Invalid selection.');
  console.log();
  return chosen.id;
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

export interface ResolvedRunnerConfig {
  muggleApiKey: string;
  projectId: string;
  repos: RepoConfig[];
}

export async function ensureRunnerConfig(): Promise<ResolvedRunnerConfig> {
  const config = loadRunnerConfig();
  let dirty = false;
  const rl = createRL();

  try {
    // 1. Muggle API key — login if needed, then read from credentials.json
    const muggleApiKey = await ensureMuggleApiKey(rl);

    // 2. Project ID — always prompt (projects change between runs)
    const projectId = await promptProjectId(rl, muggleApiKey);

    // 3. Repos — prompt once, then cache
    if (config.repos.length === 0) {
      console.log('No repositories configured yet.');
      console.log('Add the repos this runner can make changes to.\n');

      while (true) {
        const name = (await ask(rl, 'Repo name (e.g. "frontend", or Enter to finish): ')).trim();
        if (!name) break;

        const repoPath = (await ask(rl, `Absolute path to "${name}": `)).trim();
        if (!repoPath || !fs.existsSync(repoPath)) {
          console.log(`  Path "${repoPath}" not found — skipping.\n`);
          continue;
        }

        const testCmd = (await ask(rl, `Test command [pnpm test]: `)).trim() || 'pnpm test';
        config.repos.push({ name, path: repoPath, testCommand: testCmd });
        console.log(`  ✓ Added "${name}"\n`);
        dirty = true;
      }
    }

    if (dirty) {
      saveRunnerConfig(config);
      console.log('Repo config saved to ~/.muggle-ai/runner-config.json\n');
    }

    return { muggleApiKey, projectId, repos: config.repos };
  } finally {
    rl.close();
  }
}
