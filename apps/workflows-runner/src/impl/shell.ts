import { exec, spawn } from "node:child_process";

/**
 * Runs a shell command in the given working directory.
 * Captures stdout and stderr into a single output string.
 * Never throws — returns exitCode: 1 on error.
 * Default timeout: 120 seconds.
 */
export function runShell(
  command: string,
  cwd: string,
  timeoutMs = 120_000
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];

    const child = exec(command, { cwd, shell: true, timeout: timeoutMs });

    child.stdout?.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

    child.on("error", (err) => {
      chunks.push(Buffer.from(`\n[error] ${err.message}`));
      resolve({ exitCode: 1, output: Buffer.concat(chunks).toString("utf8") });
    });

    child.on("close", (code, signal) => {
      const output = Buffer.concat(chunks).toString("utf8");
      if (signal) {
        resolve({ exitCode: 1, output: output + `\n[killed by signal ${signal}]` });
      } else {
        resolve({ exitCode: code ?? 1, output });
      }
    });
  });
}

/**
 * Spawns a long-running background process.
 * Returns a handle with name, pid, and a stop() function that sends SIGTERM
 * and waits up to 5 seconds before escalating to SIGKILL.
 */
export function spawnService(
  descriptor: { name: string; startCommand: string },
  cwd?: string
): Promise<{ name: string; pid: number; stop: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const child = spawn(descriptor.startCommand, {
      cwd,
      shell: true,
      stdio: "inherit",
      detached: false,
    });

    child.on("error", (err) => {
      reject(new Error(`[spawnService:${descriptor.name}] failed to start: ${err.message}`));
    });

    // Give the process a tick to surface an immediate error before resolving.
    setTimeout(() => {
      if (child.pid == null) {
        reject(new Error(`[spawnService:${descriptor.name}] no PID assigned`));
        return;
      }

      const pid = child.pid;

      const stop = (): Promise<void> =>
        new Promise((res) => {
          // If the process has already exited, resolve immediately.
          if (child.exitCode !== null || child.signalCode !== null) {
            res();
            return;
          }

          const gracefulTimeout = setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              // process may have already exited
            }
            res();
          }, 5_000);

          child.once("close", () => {
            clearTimeout(gracefulTimeout);
            res();
          });

          try {
            child.kill("SIGTERM");
          } catch {
            // process may have already exited
            clearTimeout(gracefulTimeout);
            res();
          }
        });

      resolve({ name: descriptor.name, pid, stop });
    });
  });
}
