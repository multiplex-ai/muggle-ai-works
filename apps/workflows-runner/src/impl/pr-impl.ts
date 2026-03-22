import { execFile, exec } from 'node:child_process';
import type { RepoConfig, EnvState, ServiceHandle } from '@muggleai/workflows';
import type { PRAgentDeps, OpenPRInput } from '@muggleai/agents';

/**
 * Runs `gh pr create` via execFile (no shell) to avoid injection risks.
 * Returns stdout as a string, rejects on non-zero exit.
 */
function ghPRCreate(
  args: string[],
  cwd: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`gh pr create failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Runs an arbitrary shell command (for user-supplied stopCommand values).
 * Errors are swallowed by the caller.
 */
function runShellCommand(command: string): Promise<void> {
  return new Promise((resolve) => {
    exec(command, { shell: true }, () => resolve());
  });
}

export function createPRDeps(repos: RepoConfig[]): PRAgentDeps {
  return {
    openPR: async (input: OpenPRInput): Promise<string> => {
      const repoConfig = repos.find((r) => r.name === input.repo);
      if (!repoConfig) {
        throw new Error(`[pr-impl] No repo config found for repo: ${input.repo}`);
      }

      const args = [
        'pr', 'create',
        '--title', input.title,
        '--body', input.body,
        '--head', input.branch,
      ];

      try {
        const stdout = await ghPRCreate(args, repoConfig.path);
        // gh outputs the PR URL as the last non-empty line
        const lines = stdout.trim().split('\n').filter((l) => l.trim().length > 0);
        const url = lines[lines.length - 1]?.trim() ?? '';
        return url;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[pr-impl] openPR(${input.repo}) error: ${message}\n`);
        throw err;
      }
    },
  };
}

export function createTeardownImpl(): (env: EnvState) => Promise<void> {
  return async (env: EnvState): Promise<void> => {
    await Promise.all(
      env.services.map(async (service: ServiceHandle) => {
        try {
          if (service.stopCommand) {
            // stopCommand is a trusted, operator-configured string
            await runShellCommand(service.stopCommand);
          } else if (service.pid != null) {
            try {
              process.kill(service.pid, 'SIGTERM');
            } catch {
              // process may have already stopped
            }
          }
        } catch {
          // ignore errors — service may have already stopped
          process.stderr.write(`[pr-impl] teardown: could not stop service "${service.name}"\n`);
        }
      })
    );
  };
}
