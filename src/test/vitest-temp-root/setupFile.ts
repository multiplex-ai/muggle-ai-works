import { inject } from "vitest";
import { RUN_TEMP_ROOT_CONTEXT_KEY } from "./constants.js";
import { pointTempEnvAt } from "./runTempRoot.js";

// Runs in the worker before the test file loads, so module-level mkdtemp calls and every process a test spawns inherit it.
pointTempEnvAt(process.env, inject(RUN_TEMP_ROOT_CONTEXT_KEY));
