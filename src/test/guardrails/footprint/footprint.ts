import { spawnSync } from "child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { performance } from "perf_hooks";
import {
  HOOK_IF_RULE,
  NOOP_TRANSCRIPT_PLACEHOLDER,
  PLUGIN_ROOT,
  REGEXP_SYNTAX_CHARACTERS,
  SHIMMED_PROGRAMS,
} from "./constants.js";
import type { HookCommand, HookGroup, HookSlot, HookSlotCap, HooksManifest, SlotFootprint } from "./types.js";

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

/** Each group's distinct command strings: the `if` variants of one command are one thing the plugin runs. */
export function distinctGroupCommands(manifest: HooksManifest): string[] {
  return Object.values(manifest.hooks).flatMap((groups) =>
    groups.flatMap((group) => [...new Set(group.hooks.map((hook) => hook.command))]),
  );
}

/** Whether a group of `slot`'s event fires for it: the group has no matcher, the slot is not tool-scoped, or its tool name fully matches the matcher regex. */
export function groupFiresForSlot(group: HookGroup, slot: HookSlot): boolean {
  return !group.matcher || !slot.toolName || new RegExp(`^(?:${group.matcher})$`).test(slot.toolName);
}

/**
 * Whether Claude Code launches `hook` for a `toolName` call running `toolCommand`. With no command to judge, every
 * hook counts, so an inventory of a slot sees each gate it can reach.
 * @throws When the rule's pattern does not start and end with `*`: matching it against the whole command, as this
 * does, agrees with Claude Code matching each subcommand only for such a pattern.
 */
export function hookRunsForToolCommand(hook: HookCommand, toolName: string | undefined, toolCommand: string | undefined): boolean {
  if (hook.if === undefined || toolCommand === undefined) return true;
  const rule = HOOK_IF_RULE.exec(hook.if);
  if (!rule || !rule[2].startsWith("*") || !rule[2].endsWith("*")) {
    throw new Error(`footprint harness cannot model the if rule ${hook.if}`);
  }
  if (rule[1] !== toolName) return false;
  const literalParts = rule[2].split("*").map((part) => part.replace(REGEXP_SYNTAX_CHARACTERS, "\\$&"));
  return new RegExp(`^${literalParts.join("[\\s\\S]*")}$`).test(toolCommand);
}

/**
 * The commands Claude Code launches when `slot` fires with `payload`, honoring each group's tool-name regex and each
 * hook's `if` rule against the payload's command. Claude Code runs every hook whose rule matches, even two holding
 * the same command. Without a payload, every hook of the matching groups.
 */
export function commandsForSlot(manifest: HooksManifest, slot: HookSlot, payload?: Record<string, unknown>): HookCommand[] {
  const toolInput = payload?.tool_input as { command?: unknown } | undefined;
  const toolCommand = typeof toolInput?.command === "string" ? toolInput.command : undefined;
  const groups = manifest.hooks[slot.event] ?? [];
  return groups
    .filter((group) => groupFiresForSlot(group, slot))
    .flatMap((group) => group.hooks)
    .filter((hook) => hookRunsForToolCommand(hook, slot.toolName, toolCommand));
}

function runBash(script: string, env: NodeJS.ProcessEnv = process.env, input = ""): { stdout: string; stderr: string } {
  const bashRun = spawnSync("bash", ["-c", script], { input: input, encoding: "utf-8", env: env });
  return { stdout: bashRun.stdout ?? "", stderr: bashRun.stderr ?? "" };
}

/** `nativePath` in the form bash accepts: Git Bash needs POSIX paths inside PATH (a drive colon would split the entry) and in redirects. */
export function toBashPathArg(nativePath: string): string {
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

/**
 * `payload` as the JSON Claude Code would send, with a transcript placeholder swapped for a real file under `home`
 * whose last turn claims nothing, so the capability-claim gate reads it and stays quiet.
 */
export function hookPayloadJson(payload: Record<string, unknown>, home: string): string {
  if (payload.transcript_path !== NOOP_TRANSCRIPT_PLACEHOLDER) return JSON.stringify(payload);
  const transcriptPath = join(home, "transcript.jsonl");
  writeFileSync(transcriptPath, `${JSON.stringify({ type: "assistant", message: "All tests pass." })}\n`);
  return JSON.stringify({ ...payload, transcript_path: transcriptPath });
}

/**
 * Wall time, in milliseconds, for one no-op firing of every command in a slot with the real PATH:
 * what the harness makes a user wait on each tool call, prompt or turn end.
 */
export function timeSlotNoopFiring(manifest: HooksManifest, cap: HookSlotCap): number {
  const home = createInstalledUserHome();
  const payload = hookPayloadJson(cap.noopPayload, home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: toBashPathArg(PLUGIN_ROOT) };
  const startedAt = performance.now();
  for (const command of commandsForSlot(manifest, cap.slot, cap.noopPayload)) runBash(command.command, env, payload);
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
  const commands = commandsForSlot(manifest, cap.slot, cap.noopPayload);
  const home = createInstalledUserHome();
  const payload = hookPayloadJson(cap.noopPayload, home);
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
