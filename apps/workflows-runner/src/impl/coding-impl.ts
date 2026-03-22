import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { loadPrompt } from '@muggleai/agents';
import type { CodingAgentDeps } from '@muggleai/agents';

const execAsync = promisify(exec);

interface RepoConfig {
  name: string;
  path: string;
  testCommand: string;
}

interface LLMCodingResponse {
  files: Array<{ path: string; content: string }>;
  commitMessage: string;
}

export function createCodingImpl(
  repos: RepoConfig[],
  anthropicClient: (prompt: string) => Promise<unknown>
): CodingAgentDeps['implement'] {
  return async ({ repoEntry, retryCount, previousFailures }) => {
    // 1. Find the RepoConfig for this repo
    const repoConfig = repos.find((r) => r.name === repoEntry.repo);
    if (!repoConfig) {
      throw new Error(`No RepoConfig found for repo "${repoEntry.repo}"`);
    }

    // 2. Create a git branch
    const branch = `feat/dev-cycle-${Date.now()}`;
    await execAsync(`git checkout -b ${branch}`, { cwd: repoConfig.path });

    // 3. Read current file contents
    const fileContents: Array<{ path: string; content: string }> = await Promise.all(
      repoEntry.files.map(async (filePath) => {
        const absolutePath = join(repoConfig.path, filePath);
        try {
          const content = await readFile(absolutePath, 'utf-8');
          return { path: filePath, content };
        } catch {
          return { path: filePath, content: '(new file)' };
        }
      })
    );

    // 4. Build the prompt
    const systemPrompt = await loadPrompt('coding-agent');

    const fileSection = fileContents
      .map(({ path, content }) =>
        `### File: ${path}\n\`\`\`\n${content}\n\`\`\``
      )
      .join('\n\n');

    const changesSection = repoEntry.changes
      .map((change, i) => `${i + 1}. ${change}`)
      .join('\n');

    let retrySection = '';
    if (retryCount > 0 && previousFailures.length > 0) {
      retrySection = `\n\n## Retry context (attempt ${retryCount})\n\nPrevious failures to fix:\n${previousFailures.map((f) => `- ${f}`).join('\n')}`;
    }

    const prompt = `${systemPrompt}

## Repository: ${repoEntry.repo}

## Files to modify

${fileSection}

## Required changes

${changesSection}${retrySection}`;

    // 5. Call the LLM client (returns already-parsed JSON)
    const response = anthropicClient(prompt) as Promise<LLMCodingResponse>;
    const llmResult = await response;
    const { files, commitMessage } = llmResult as LLMCodingResponse;

    // 6. Write each file (create parent dirs if needed)
    await Promise.all(
      files.map(async ({ path: filePath, content }) => {
        const absolutePath = join(repoConfig.path, filePath);
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, content, 'utf-8');
      })
    );

    // 7. Commit the changes
    await execAsync(`git add -A && git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {
      cwd: repoConfig.path,
    });

    // 8. Get the diff
    const { stdout: diff } = await execAsync('git diff HEAD~1', { cwd: repoConfig.path });

    // 9. Return result
    return { branch, diff };
  };
}
