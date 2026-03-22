import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { RepoConfig } from '@muggleai/workflows';

export interface RunnerConfig {
  repos: RepoConfig[];
}

const CONFIG_PATH = path.join(os.homedir(), '.muggle-ai', 'runner-config.json');

export function loadRunnerConfig(): RunnerConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as RunnerConfig;
    }
  } catch {
    // ignore corrupt config — start fresh
  }
  return { repos: [] };
}

export function saveRunnerConfig(config: RunnerConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}
