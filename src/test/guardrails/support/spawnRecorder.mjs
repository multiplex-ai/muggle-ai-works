// Preloaded with `node --import` ahead of the entry, so it patches child_process before any module, dependencies
// included, captures a reference to it. The default export is the same object `require("child_process")` returns.
// Appends one JSON line per child started without windowsHide to the file named by MUGGLE_SPAWN_RECORD_FILE.
import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const recordFile = process.env.MUGGLE_SPAWN_RECORD_FILE;

function recordUnhidden(entryPoint, file, args) {
  appendFileSync(recordFile, `${JSON.stringify({ entryPoint: entryPoint, file: file, args: (args ?? []).slice(0, 6) })}\n`);
}

function optionsArgument(callArguments) {
  const last = callArguments.findLast((argument) => typeof argument === "object" && argument !== null);
  return Array.isArray(last) ? undefined : last;
}

// spawn, exec, execFile and fork all reach ChildProcess#spawn with their options normalised.
const originalSpawn = childProcess.ChildProcess.prototype.spawn;
childProcess.ChildProcess.prototype.spawn = function recordedSpawn(options) {
  if (options.windowsHide !== true) recordUnhidden("ChildProcess#spawn", options.file, options.args);
  return originalSpawn.call(this, options);
};

for (const syncFunctionName of ["spawnSync", "execSync", "execFileSync"]) {
  const original = childProcess[syncFunctionName];
  childProcess[syncFunctionName] = function recordedSyncSpawn(...callArguments) {
    if (optionsArgument(callArguments.slice(1))?.windowsHide !== true) {
      recordUnhidden(syncFunctionName, callArguments[0], Array.isArray(callArguments[1]) ? callArguments[1] : []);
    }
    return original.apply(this, callArguments);
  };
}

syncBuiltinESMExports();
