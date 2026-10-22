/**
 * Mock muggle tools this eval serves beside skill-gate-eval's shared list:
 * the cloud reads an E2E stage makes between picking test cases and
 * gathering screenshots. Without them a skill run reaches for a tool that
 * does not exist and the scenario measures the gap, not the skill.
 */

import type { Fixtures, MockToolSpec } from "../../../skill-gate-eval/src/types.js";
import {
  DEFAULT_ACTION_SCRIPT,
  DEFAULT_TEST_CASE_ANCESTORS,
  DEFAULT_TEST_SCRIPT,
  EMPTY_MOCK_LIST,
} from "../constants.js";

/** The supplemental mock tools, each answering from its fixture slot or a stub. */
export function supplementalMockToolSpecs(fixtures: Fixtures): MockToolSpec[] {
  return [
    {
      name: "muggle-remote-test-case-list",
      description: "A project's test cases (mock).",
      shape: {},
      reply: () => fixtures.testCases ?? EMPTY_MOCK_LIST,
    },
    {
      name: "muggle-remote-test-case-ancestors-get",
      description: "A test case's prerequisite chain in the test-plan graph (mock).",
      shape: {},
      reply: () => fixtures.testCaseAncestors ?? DEFAULT_TEST_CASE_ANCESTORS,
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
  ];
}
