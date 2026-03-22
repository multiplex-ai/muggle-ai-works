/**
 * Interactive first-run setup wizard.
 *
 * Fills in any missing fields in RunnerConfig by prompting the user,
 * then caches the result in ~/.muggle-ai/runner-config.json.
 *
 * Zero env vars required — all values are either auto-detected or prompted once.
 * Env vars (ANTHROPIC_API_KEY, MUGGLE_API_KEY, MUGGLE_PROJECT_ID) still work
 * as overrides for CI/automation.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';

import axios from 'axios';

import type { RepoConfig } from '@muggleai/workflows';

import { loadRunnerConfig, saveRunnerConfig } from './runner-config.js';
import type { RunnerConfig } from './runner-config.js';

// ---------------------------------------------------------------------------
// Readline helpers
// ---------------------------------------------------------------------------

function createRL(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

// ---------------------------------------------------------------------------
// Muggle credentials (set by `muggle login`)
// ---------------------------------------------------------------------------

interface RawCredentials {
  accessToken?: string;
  apiKey?: string;
  expiresAt?: string;
}

function readMuggleApiKey(): string | undefined {
  // Env override takes priority (CI/automation)
  if (process.env['MUGGLE_API_KEY']) return process.env['MUGGLE_API_KEY'];

  const credPath = path.join(os.homedir(), '.muggle-ai', 'credentials.json');
  try {
    if (!fs.existsSync(credPath)) return undefined;
    const raw = JSON.parse(fs.readFileSync(credPath, 'utf-8')) as RawCredentials;
    return raw.apiKey ?? undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Project listing
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

// ---------------------------------------------------------------------------
// Main setup entrypoint
// ---------------------------------------------------------------------------

export async function ensureRunnerConfig(): Promise<
  RunnerConfig & { muggleApiKey: string }
> {
  const config = loadRunnerConfig();
  let dirty = false;
  const rl = createRL();

  try {
    // 1. Anthropic API key
    if (!process.env['ANTHROPIC_API_KEY'] && !config.anthropicApiKey) {
      console.log('\nAnthropic API key not found.');
      const key = (await question(rl, 'Enter your Anthropic API key (sk-ant-...): ')).trim();
      if (!key) throw new Error('Anthropic API key is required.');
      config.anthropicApiKey = key;
      dirty = true;
    }
    // Apply cached key to env so the Anthropic SDK picks it up automatically
    if (config.anthropicApiKey && !process.env['ANTHROPIC_API_KEY']) {
      process.env['ANTHROPIC_API_KEY'] = config.anthropicApiKey;
    }

    // 2. Muggle API key (from stored credentials)
    const muggleApiKey = readMuggleApiKey();
    if (!muggleApiKey) {
      console.error(
        '\nNo Muggle credentials found. Please run `muggle login` first, then try again.',
      );
      process.exit(1);
    }

    // 3. Project ID
    if (!process.env['MUGGLE_PROJECT_ID'] && !config.projectId) {
      console.log('\nFetching your Muggle projects…');
      const projects = await fetchProjects(muggleApiKey);

      if (projects.length === 0) {
        const id = (await question(rl, 'No projects found. Enter your project ID manually: ')).trim();
        if (!id) throw new Error('A project ID is required.');
        config.projectId = id;
      } else if (projects.length === 1) {
        console.log(`Using project: ${projects[0]!.name} (${projects[0]!.id})`);
        config.projectId = projects[0]!.id;
      } else {
        console.log('\nAvailable projects:');
        projects.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}  (${p.id})`));
        const pick = (await question(rl, `Select project [1-${projects.length}]: `)).trim();
        const idx = parseInt(pick, 10) - 1;
        const chosen = projects[idx];
        if (!chosen) throw new Error('Invalid selection.');
        config.projectId = chosen.id;
      }
      dirty = true;
    }
    const projectId = process.env['MUGGLE_PROJECT_ID'] ?? config.projectId!;

    // 4. Repos config
    if (config.repos.length === 0) {
      console.log('\nNo repositories configured yet.');
      console.log('Add the repos this runner can make changes to.\n');

      while (true) {
        const name = (await question(rl, 'Repo name (e.g. "frontend", or Enter to finish): ')).trim();
        if (!name) break;

        const repoPath = (await question(rl, `Absolute path to "${name}": `)).trim();
        if (!repoPath || !fs.existsSync(repoPath)) {
          console.log(`  Path not found: ${repoPath} — skipping.`);
          continue;
        }

        const testCmd = (await question(rl, `Test command for "${name}" [pnpm test]: `)).trim() || 'pnpm test';

        config.repos.push({ name, path: repoPath, testCommand: testCmd } satisfies RepoConfig);
        console.log(`  ✓ Added "${name}"\n`);
        dirty = true;
      }
    }

    if (dirty) {
      saveRunnerConfig(config);
      console.log(`\nConfig saved to ~/.muggle-ai/runner-config.json\n`);
    }

    return { ...config, muggleApiKey, projectId };
  } finally {
    rl.close();
  }
}
