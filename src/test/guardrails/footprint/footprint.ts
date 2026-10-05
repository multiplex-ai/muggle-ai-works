import { spawnSync } from "child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { performance } from "perf_hooks";
import { fileURLToPath } from "url";
import { NOOP_TRANSCRIPT_PLACEHOLDER, SHIMMED_PROGRAMS } from "./constants.js";
import type { HookCommand, HookSlot, HookSlotCap, HooksManifest, SlotFootprint } from "./types.js";

const PLUGIN_ROOT = fileURLToPath(new URL("../../../../plugin", import.meta.url));
const MANIFEST_PATH = join(PLUGIN_ROOT, "hooks", "hooks.json");
const UNSHIMMED_PATTERN = /(?:^|\s)([\w.+-]+): (?:command not found|No such file or directory)/g;

/** Reads plugin/hooks/hooks.json. */
export function loadHooksManifest(): HooksManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as HooksManifest;
}

/** Every hook command in the manifest, across all events and matchers. */
export function allHookCommands(manifest: HooksManifest): HookCommand[] {
  return Object.values(manifest.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
}

/** The commands the harness launches when `slot` fires, honoring each group's tool-name regex. */
export function commandsForSlot(manifest: HooksManifest, slot: HookSlot): HookCommand[] {
  const groups = manifest.hooks[slot.event] ?? [];
  return groups
    .filter((group) => !group.matcher || !slot.toolName || new RegExp(`^(?:${group.matcher})$`).test(slot.toolName))
    .flatMap((group) => group.hooks);
}

function runBash(script: string, env: NodeJS.ProcessEnv = process.env, input = ""): { stdout: string; stderr: string } {
  const bashRun = spawnSync("bash", ["-c", script], { input: input, encoding: "utf-8", env: env });
  return { stdout: bashRun.stdout ?? "", stderr: bashRun.stderr ?? "" };
}

// Git Bash needs POSIX paths inside PATH (a drive colon would split the entry) and in redirects.
function toBashPathArg(nativePath: string): string {
  if (process.platform !== "win32") return nativePath;
  const cygpathRun = spawnSync("bash", ["-c", 'cygpath -u "$1"', "_", nativePath], { encoding: "utf-8" });
  return (cygpathRun.stdout ?? "").trim() || nativePath.replace(/\\/g, "/");
}

/**
 * Builds a directory of logging shims, one per SHIMMED_PROGRAMS entry found on this machine. Each
 * shim appends its name to $FOOTPRINT_SPAWN_LOG and execs the real binary by absolute path, so a
 * hook run with PATH set to this directory records every external program it starts. `gh` is
 * stubbed to fail instead, so no measurement can reach the network.
 */
export function createSpawnShimDirectory(): string {
  const shimDirectory = mkdtempSync(join(tmpdir(), "footprint-shims-"));
  const lookup = runBash(
    `for program in ${SHIMMED_PROGRAMS.join(" ")}; do printf '%s=%s\\n' "$program" "$(type -P "$program")"; done`,
  ).stdout;
  const realPaths = new Map<string, string>();
  for (const line of lookup.split("\n")) {
    const [program, realPath] = line.trim().split("=");
    if (program && realPath) realPaths.set(program, realPath);
  }
  const realBash = realPaths.get("bash");
  if (!realBash) throw new Error("footprint harness: bash not found on PATH");
  for (const [program, realPath] of realPaths) {
    const body =
      program === "gh"
        ? `printf '%s\\n' gh >> "$FOOTPRINT_SPAWN_LOG"\nexit 1\n`
        : `printf '%s\\n' ${program} >> "$FOOTPRINT_SPAWN_LOG"\nexec "${realPath}" "$@"\n`;
    const shimPath = join(shimDirectory, program);
    writeFileSync(shimPath, `#!${realBash}\n${body}`);
    chmodSync(shimPath, 0o755);
  }
  return shimDirectory;
}

function createInstalledUserHome(): string {
  const home = mkdtempSync(join(tmpdir(), "footprint-home-"));
  mkdirSync(join(home, ".muggle-ai"), { recursive: true });
  return home;
}

// A transcript whose last turn claims nothing, so the capability-claim gate reads it and stays quiet.
function noopPayloadJson(cap: HookSlotCap, home: string): string {
  if (cap.noopPayload.transcript_path !== NOOP_TRANSCRIPT_PLACEHOLDER) return JSON.stringify(cap.noopPayload);
  const transcriptPath = join(home, "transcript.jsonl");
  writeFileSync(transcriptPath, `${JSON.stringify({ type: "assistant", message: "All tests pass." })}\n`);
  return JSON.stringify({ ...cap.noopPayload, transcript_path: transcriptPath });
}

/**
 * Wall time, in milliseconds, for one no-op firing of every command in a slot with the real PATH:
 * what the harness makes a user wait on each tool call, prompt or turn end.
 */
export function timeSlotNoopFiring(manifest: HooksManifest, cap: HookSlotCap): number {
  const home = createInstalledUserHome();
  const payload = noopPayloadJson(cap, home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: toBashPathArg(PLUGIN_ROOT) };
  const startedAt = performance.now();
  for (const command of commandsForSlot(manifest, cap.slot)) runBash(command.command, env, payload);
  return performance.now() - startedAt;
}

/**
 * Fires every command of a slot once with the slot's no-op payload, the way Claude Code would, and
 * records what each command exec'd beyond its own launch. HOME is a throwaway dir that already
 * holds `.muggle-ai`, matching an installed user, so the Windows home-resolution fallback stays
 * off and the counts agree across platforms.
 *
 * Output shape: `{ commandCount: 9, spawnedPrograms: ["cat", "grep", "head", "sed"], unshimmedPrograms: [] }`
 */
export function measureSlotFootprint(manifest: HooksManifest, cap: HookSlotCap, shimDirectory: string): SlotFootprint {
  const commands = commandsForSlot(manifest, cap.slot);
  const home = createInstalledUserHome();
  const payload = noopPayloadJson(cap, home);
  const shimPathForBash = toBashPathArg(shimDirectory);
  const spawnedPrograms: string[] = [];
  const unshimmedPrograms: string[] = [];
  commands.forEach((command, index) => {
    const spawnLog = join(home, `spawns-${index}.log`);
    const { stderr } = runBash(
      `PATH='${shimPathForBash}'; ${command.command}`,
      {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CLAUDE_PLUGIN_ROOT: toBashPathArg(PLUGIN_ROOT),
        FOOTPRINT_SPAWN_LOG: toBashPathArg(spawnLog),
        MUGGLE_GUARDRAIL_GH_CALLS: "off",
      },
      payload,
    );
    const logged = existsSync(spawnLog) ? readFileSync(spawnLog, "utf-8").split("\n").filter(Boolean) : [];
    // The first entry is the command's own launch (e.g. the `bash` in `bash "<script>"`); that
    // cost is counted as maxCommands, not as a no-op spawn.
    spawnedPrograms.push(...logged.slice(1));
    for (const match of stderr.matchAll(UNSHIMMED_PATTERN)) unshimmedPrograms.push(match[1]);
  });
  return { commandCount: commands.length, spawnedPrograms: spawnedPrograms, unshimmedPrograms: unshimmedPrograms };
}
