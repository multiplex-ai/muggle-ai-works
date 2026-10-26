import { readFileSync } from "fs";
import { runPrWatchVerdictCommand } from "./verdictCommand.js";
import { resolveWatchPreferences } from "./watchPreferences.js";

// The slot's last_seen.json arrives on stdin rather than by path: under Git Bash a slot path is POSIX, which
// Windows node cannot open. An absent file is fed as empty input and reads as an entry with nothing recorded.
function readLastSeenFromStdin(): string {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

const outcome = runPrWatchVerdictCommand(process.argv.slice(2), readLastSeenFromStdin(), () => resolveWatchPreferences());
process.stderr.write(outcome.stderr);
process.stdout.write(outcome.stdout);
process.exitCode = outcome.exitCode;
