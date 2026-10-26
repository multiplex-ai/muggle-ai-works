/**
 * The shared mock muggle tools (skill-gate-eval's mock-tools.ts) plus this
 * eval's supplemental ones, with sequenced fixture slots: a slot holding
 * `{ "sequence": [...] }` answers its nth call with the nth entry, the last
 * repeating — a failing run, then a passing one, for the E2E repair loop.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

import { jsonResult, mockToolSpecs } from "../../../skill-gate-eval/src/mock-tools.js";
import type { Fixtures, MockServerHandle } from "../../../skill-gate-eval/src/types.js";
import { EVAL_MCP_SERVER_VERSION, MOCK_MCP_SERVER_NAME } from "../constants.js";
import type { InputAwareMockToolSpec, SequencedFixture } from "../types.js";
import { sequenceEntryAt } from "./scripted-replies.js";
import { supplementalMockToolSpecs } from "./supplemental-mock-tools.js";

/** True for a fixture slot holding exactly `{ sequence: [<one or more replies>] }`. */
export function isSequencedFixture(value: unknown): value is SequencedFixture {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const sequence = (value as { sequence?: unknown }).sequence;
  return Object.keys(value).length === 1 && Array.isArray(sequence) && sequence.length > 0;
}

/**
 * Every mock tool a run serves, one per name. A supplemental tool named like a
 * shared one refines it: the supplemental tool answers first, and a call it
 * returns nothing for falls through to the shared tool's reply. Its input shape
 * extends the shared one's, so fields a gate reads off the shared shape still arrive.
 */
export function mergedMockToolSpecs(fixtures: Fixtures): InputAwareMockToolSpec[] {
  const supplementalByName = new Map(supplementalMockToolSpecs(fixtures).map((spec) => [spec.name, spec]));
  const sharedSpecs = mockToolSpecs(fixtures).map((sharedSpec): InputAwareMockToolSpec => {
    const refinement = supplementalByName.get(sharedSpec.name);
    if (!refinement) return sharedSpec;
    supplementalByName.delete(sharedSpec.name);
    return {
      ...refinement,
      shape: { ...sharedSpec.shape, ...refinement.shape },
      reply: (input) => refinement.reply(input) ?? sharedSpec.reply(),
    };
  });
  return [...sharedSpecs, ...supplementalByName.values()];
}

/**
 * The mock tools with each sequenced slot resolved per call. Calls count per
 * slot, not per tool: execute-test-generation and execute-replay both answer
 * from `executeResult`, so a generation and then a replay get its first and
 * second entries.
 */
export function sequencedMockToolSpecs(fixtures: Fixtures): InputAwareMockToolSpec[] {
  const callCountsBySlot = new Map<SequencedFixture, number>();
  return mergedMockToolSpecs(fixtures).map((spec) => ({
    ...spec,
    reply: (input) => {
      const slotValue = spec.reply(input);
      if (!isSequencedFixture(slotValue)) return slotValue;
      const callIndex = callCountsBySlot.get(slotValue) ?? 0;
      callCountsBySlot.set(slotValue, callIndex + 1);
      return sequenceEntryAt(slotValue.sequence, callIndex);
    },
  }));
}

/**
 * An answerer for mock muggle calls outside the server — a seeded transcript's
 * — with its own sequence counts: each bare tool name answers as the server
 * would, as the MCP text it would carry.
 *
 * @throws from the answerer when no mock tool has the name.
 */
export function createMockToolAnswerer(fixtures: Fixtures): (toolName: string) => string {
  const specsByName = new Map(sequencedMockToolSpecs(fixtures).map((spec) => [spec.name, spec]));
  return (toolName) => {
    const spec = specsByName.get(toolName);
    if (!spec) throw new Error(`no mock muggle tool is named ${toolName}`);
    return jsonResult(spec.reply({})).content[0].text;
  };
}

/** Build the in-process mock muggle server for one run. */
export function buildSequencedMockMcpServer(fixtures: Fixtures): MockServerHandle {
  const config = createSdkMcpServer({
    name: MOCK_MCP_SERVER_NAME,
    version: EVAL_MCP_SERVER_VERSION,
    tools: sequencedMockToolSpecs(fixtures).map((spec) =>
      tool(spec.name, spec.description, spec.shape, async (input) =>
        jsonResult(spec.reply(input as Record<string, unknown>)),
      ),
    ),
  });
  return { config: config };
}
