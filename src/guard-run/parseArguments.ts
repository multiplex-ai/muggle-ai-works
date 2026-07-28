import { GUARD_RUN_DEFAULT_ACTIVE_PROCESS_LIMIT, GUARD_RUN_USAGE } from "./constants.js";
import { GuardRunParseResult } from "./types.js";

function parseError(errorMessage: string): GuardRunParseResult {
  return { options: null, errorMessage: `${errorMessage}\n${GUARD_RUN_USAGE}` };
}

function parsePositiveInteger(rawValue: string | undefined): number | null {
  if (rawValue === undefined || !/^\d+$/.test(rawValue)) return null;
  const parsed = Number(rawValue);
  return parsed >= 1 ? parsed : null;
}

export function parseGuardRunArguments(argv: string[]): GuardRunParseResult {
  let activeProcessLimit = GUARD_RUN_DEFAULT_ACTIVE_PROCESS_LIMIT;
  let isServiceMode = false;
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === "--") {
      index += 1;
      break;
    }
    if (token === "--service") {
      isServiceMode = true;
      index += 1;
      continue;
    }
    if (token === "--limit" || token.startsWith("--limit=")) {
      const rawLimit = token === "--limit" ? argv[index + 1] : token.slice("--limit=".length);
      const parsedLimit = parsePositiveInteger(rawLimit);
      if (parsedLimit === null) return parseError("--limit requires a positive integer");
      activeProcessLimit = parsedLimit;
      index += token === "--limit" ? 2 : 1;
      continue;
    }
    // A mistyped flag must never silently become the guarded command.
    if (token.startsWith("--")) return parseError(`unknown flag: ${token}`);
    break;
  }
  const command = argv.slice(index);
  if (command.length === 0) return parseError("no command given");
  return {
    options: {
      activeProcessLimit: activeProcessLimit,
      isServiceMode: isServiceMode,
      command: command,
    },
    errorMessage: null,
  };
}
