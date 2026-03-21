import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const promptsDir = join(dirname(fileURLToPath(import.meta.url)), 'prompts');

export async function loadPrompt(name: string): Promise<string> {
  return readFile(join(promptsDir, `${name}.md`), 'utf-8');
}
