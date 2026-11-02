/**
 * Mock muggle tools this eval serves beside skill-gate-eval's shared list.
 * Without them a skill run reaches for a tool that does not exist and the
 * scenario measures the gap, not the skill:
 *   - the cloud reads an E2E stage makes between picking test cases and
 *     gathering screenshots;
 *   - per-id refinements of the shared list and get tools, so a project with
 *     several use cases answers each one with its own test cases;
 *   - the create and delete calls that plan, create, and retire cases;
 *   - per-case runs: executing a case other than the fixture run's own answers
 *     with that run retargeted to the case, under a run id the run-result and
 *     run-steps reads then answer for, so each case a run plans has evidence of its own;
 *   - the event-emit call's real fields, so a workflow event can name its type.
 * A tool named like a shared one refines it (see sequenced-mock-mcp.ts).
 */

import { z } from "zod";

import type { Fixtures } from "../../../skill-gate-eval/src/types.js";
import {
  CREATED_TEST_CASE_ID_PREFIX,
  CREATED_TEST_CASE_STATUS,
  CREATED_USE_CASE_ID_PREFIX,
  DEFAULT_ACTION_SCRIPT,
  DEFAULT_TEST_CASE_ANCESTORS,
  DEFAULT_TEST_SCRIPT,
  EMPTY_MOCK_LIST,
} from "../constants.js";
import type { InputAwareMockToolSpec } from "../types.js";

const optionalId = z.string().optional();

/** The items of a list reply: an array, or an object's `items` array; anything else lists nothing. */
function listedItems(listReply: unknown): Record<string, unknown>[] {
  if (Array.isArray(listReply)) return listReply as Record<string, unknown>[];
  const listedArray = (listReply as { items?: unknown } | null)?.items;
  return Array.isArray(listedArray) ? (listedArray as Record<string, unknown>[]) : [];
}

/** The `testCasesByUseCase` fixture: each use case id mapped to its list reply. Unset, the shared list answers. */
function testCasesByUseCaseOf(fixtures: Fixtures): Record<string, unknown> | undefined {
  const byUseCase = fixtures.testCasesByUseCase;
  return typeof byUseCase === "object" && byUseCase !== null ? (byUseCase as Record<string, unknown>) : undefined;
}

/** Every test case the `testCasesByUseCase` lists hold, in use case order. */
function allListedTestCases(fixtures: Fixtures): Record<string, unknown>[] {
  return Object.values(testCasesByUseCaseOf(fixtures) ?? {}).flatMap(listedItems);
}

/** The project's test cases: the `testCases` slot, else every per-use-case list's cases, else none. */
function projectTestCases(fixtures: Fixtures): unknown {
  if (fixtures.testCases !== undefined) return fixtures.testCases;
  return testCasesByUseCaseOf(fixtures) ? { items: allListedTestCases(fixtures) } : EMPTY_MOCK_LIST;
}

/** A run fixture as an object, or undefined for an absent or sequenced slot, which the shared reply answers. */
function plainRunFixture(fixture: unknown): Record<string, unknown> | undefined {
  if (typeof fixture !== "object" || fixture === null || Array.isArray(fixture)) return undefined;
  return Array.isArray((fixture as { sequence?: unknown }).sequence) ? undefined : (fixture as Record<string, unknown>);
}

/** The id of the case an execute call runs: its `testCase` argument is an object, or the JSON text agents often send. */
function executedTestCaseId(testCaseArgument: unknown): string | undefined {
  let testCase = testCaseArgument;
  if (typeof testCase === "string") {
    try {
      testCase = JSON.parse(testCase);
    } catch {
      return undefined;
    }
  }
  const testCaseId = (testCase as { id?: unknown } | null | undefined)?.id;
  return typeof testCaseId === "string" ? testCaseId : undefined;
}

/** `run` with its run id and test case id replaced wherever they appear, so its URLs and paths name the retargeted run. */
function retargetedRun(
  run: Record<string, unknown>,
  fromIds: { runId: string; testCaseId?: string },
  toIds: { runId: string; testCaseId: string },
): unknown {
  let runText = JSON.stringify(run).replaceAll(fromIds.runId, toIds.runId);
  if (fromIds.testCaseId) runText = runText.replaceAll(fromIds.testCaseId, toIds.testCaseId);
  return JSON.parse(runText);
}

/**
 * The supplemental mock tools for one run, each answering from its fixture
 * slot or a stub. Cases the run creates are numbered from 1 and read back by
 * `muggle-remote-test-case-get`.
 */
export function supplementalMockToolSpecs(fixtures: Fixtures): InputAwareMockToolSpec[] {
  const createdTestCasesById = new Map<string, Record<string, unknown>>();
  const executedTestCaseIdByRunId = new Map<string, string>();
  let createdUseCaseCount = 0;
  const executeFixtureTestCaseId = (): string | undefined => {
    const fixtureTestCaseId = plainRunFixture(fixtures.executeResult)?.testCaseId;
    return typeof fixtureTestCaseId === "string" ? fixtureTestCaseId : undefined;
  };
  const executedRun = (input: Record<string, unknown>): unknown => {
    const run = plainRunFixture(fixtures.executeResult);
    const testCaseId = executedTestCaseId(input.testCase);
    if (!run || typeof run.runId !== "string" || !testCaseId || testCaseId === run.testCaseId) return undefined;
    const runId = `${run.runId}-${testCaseId}`;
    executedTestCaseIdByRunId.set(runId, testCaseId);
    return retargetedRun(run, { runId: run.runId, testCaseId: executeFixtureTestCaseId() }, { runId: runId, testCaseId: testCaseId });
  };
  const runRead = (runFixture: unknown, input: Record<string, unknown>): unknown => {
    const run = plainRunFixture(runFixture);
    const runId = typeof input.runId === "string" ? input.runId : undefined;
    const testCaseId = runId ? executedTestCaseIdByRunId.get(runId) : undefined;
    if (!run || typeof run.runId !== "string" || !runId || !testCaseId) return undefined;
    const fixtureTestCaseId = typeof run.testCaseId === "string" ? run.testCaseId : executeFixtureTestCaseId();
    return retargetedRun(run, { runId: run.runId, testCaseId: fixtureTestCaseId }, { runId: runId, testCaseId: testCaseId });
  };
  return [
    {
      name: "muggle-remote-test-case-list",
      description: "A project's test cases (mock).",
      shape: {},
      reply: () => projectTestCases(fixtures),
    },
    {
      name: "muggle-remote-test-case-ancestors-get",
      description: "A test case's prerequisite chain in the test-plan graph (mock).",
      shape: { testCaseId: optionalId },
      reply: (input) =>
        fixtures.testCaseAncestors ?? {
          ...DEFAULT_TEST_CASE_ANCESTORS,
          testCaseId: input.testCaseId ?? DEFAULT_TEST_CASE_ANCESTORS.testCaseId,
        },
    },
    {
      name: "muggle-remote-test-script-get",
      description: "A cloud test script with its per-step screenshots (mock).",
      shape: {},
      reply: () => fixtures.testScript ?? DEFAULT_TEST_SCRIPT,
    },
    {
      name: "muggle-remote-action-script-get",
      description: "A cloud action script with its steps and recorded action params (mock).",
      shape: {},
      reply: () => fixtures.actionScript ?? DEFAULT_ACTION_SCRIPT,
    },
    {
      name: "muggle-remote-test-case-list-by-use-case",
      description: "List test cases for a specific use case (mock).",
      shape: { useCaseId: optionalId, projectId: optionalId },
      reply: (input) => {
        const byUseCase = testCasesByUseCaseOf(fixtures);
        if (!byUseCase) return undefined;
        return byUseCase[String(input.useCaseId)] ?? EMPTY_MOCK_LIST;
      },
    },
    {
      name: "muggle-remote-test-case-get",
      description: "Test-case get (mock).",
      shape: { testCaseId: optionalId, projectId: optionalId },
      reply: (input) => {
        const testCaseId = String(input.testCaseId);
        return (
          createdTestCasesById.get(testCaseId) ??
          allListedTestCases(fixtures).find((testCase) => testCase.id === testCaseId)
        );
      },
    },
    {
      name: "muggle-remote-use-case-create-from-prompts",
      description: "Create one or more use cases from natural language instructions (mock).",
      shape: { projectId: optionalId, instructions: z.array(z.string()).optional() },
      reply: (input) => ({
        items: ((input.instructions as string[] | undefined) ?? []).map((instruction) => ({
          id: `${CREATED_USE_CASE_ID_PREFIX}${++createdUseCaseCount}`,
          projectId: input.projectId,
          title: instruction,
          description: instruction,
        })),
      }),
    },
    {
      name: "muggle-remote-test-case-generate-from-prompt",
      description: "Generate preview test cases from a plain-English description of what to test (mock).",
      shape: { projectId: optionalId, useCaseId: optionalId, instruction: z.string().optional() },
      reply: (input) => ({
        testCases: [
          {
            useCaseId: input.useCaseId,
            title: input.instruction,
            description: input.instruction,
            goal: input.instruction,
            expectedResult: input.instruction,
          },
        ],
      }),
    },
    {
      name: "muggle-remote-test-case-create",
      description: "Create a new test case for a use case (mock).",
      shape: {
        projectId: optionalId,
        useCaseId: optionalId,
        title: z.string().optional(),
        description: z.string().optional(),
        goal: z.string().optional(),
        precondition: z.string().optional(),
        expectedResult: z.string().optional(),
        url: z.string().optional(),
      },
      reply: (input) => {
        const created = {
          ...input,
          id: `${CREATED_TEST_CASE_ID_PREFIX}${createdTestCasesById.size + 1}`,
          status: CREATED_TEST_CASE_STATUS,
        };
        createdTestCasesById.set(created.id, created);
        return created;
      },
    },
    {
      name: "muggle-remote-test-case-delete",
      description: "Delete a test case by ID. This is a soft delete (mock).",
      shape: { testCaseId: optionalId },
      reply: (input) => ({ id: input.testCaseId, deleted: true }),
    },
    {
      name: "muggle-remote-use-case-delete",
      description: "Delete a use case by ID. Soft delete, and it cascades to its test cases and scripts (mock).",
      shape: { useCaseId: optionalId },
      reply: (input) => ({ id: input.useCaseId, deleted: true }),
    },
    {
      name: "muggle-local-execute-test-generation",
      description: "Execute test generation (mock — args recorded by canUseTool, never actually runs).",
      shape: {},
      reply: executedRun,
    },
    {
      name: "muggle-local-execute-replay",
      description: "Execute replay (mock — args recorded by canUseTool, never actually runs).",
      shape: {},
      reply: executedRun,
    },
    {
      name: "muggle-local-run-result-get",
      description: "Run result (mock).",
      shape: { runId: optionalId },
      reply: (input) => runRead(fixtures.runResult, input),
    },
    {
      name: "muggle-local-run-steps-get",
      description: "A run's steps beside the frames they produced (mock).",
      shape: { runId: optionalId },
      reply: (input) => runRead(fixtures.runStepsResult, input),
    },
    {
      name: "muggle-local-telemetry-event-emit",
      description: "Emit one workflow or failure-mode telemetry event from the catalog (mock).",
      shape: {
        eventType: z.string().optional(),
        skillName: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
      reply: () => ({ ok: true }),
    },
  ];
}
