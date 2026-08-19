import * as fs from "node:fs/promises";

import { type TaskFileSystem } from "./types";

/** Real-disk implementation of the per-task filesystem port. */
export const nodeTaskFileSystem: TaskFileSystem = {
  recreateDirAsync: async (dirPath: string): Promise<void> => {
    await fs.rm(dirPath, { recursive: true, force: true });
    await fs.mkdir(dirPath, { recursive: true });
  },
  writeTextAsync: (filePath: string, content: string): Promise<void> =>
    fs.writeFile(filePath, content, "utf8"),
  readTextAsync: (filePath: string): Promise<string> => fs.readFile(filePath, "utf8"),
};
