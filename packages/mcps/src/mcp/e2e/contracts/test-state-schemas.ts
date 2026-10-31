import { z } from "zod";

import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";
import {
  TEST_STATE_PARALLEL_ACCOUNT_SET_LIMIT_DEFAULT,
  TEST_STATE_PARALLEL_ACCOUNT_SET_LIMIT_MAX,
  TEST_STATE_PARALLEL_ACCOUNT_SET_LIMIT_MIN,
} from "./constants.js";
import { TestRoleSourceEnum, TestStateFactScopeEnum } from "./test-state-types.js";

const TestStateProjectIdSchema = MuggleEntityIdSchema.describe("Project ID (UUID) that owns the test states and roles");
const TestStateIdSchema = MuggleEntityIdSchema.describe("Test state ID (UUID)");
const TestRoleIdSchema = MuggleEntityIdSchema.describe("Test role ID (UUID)");

/** One fact a test state holds about an account set's data, in the prompt-service wire shape. */
export const TestStateFactSchema = z.object({
  statement: z.string().min(1).describe("What holds, e.g. 'the thread shows one unread message'"),
  scope: z
    .enum(TestStateFactScopeEnum)
    .describe(
      "ACCOUNT_SET: only this account set's data, e.g. the patient's thread with the doctor. ACCOUNT: one account as a whole, e.g. the doctor's unread count",
    ),
  roleId: MuggleEntityIdSchema.nullable().describe("Test role ID (UUID) whose account an ACCOUNT fact is about; null for an ACCOUNT_SET fact"),
});

const TestStateFactsSchema = z
  .array(TestStateFactSchema)
  .describe("Every fact the state's tests rely on");
const TestStateCheckSchema = z
  .string()
  .describe("Quick read-only check that an account set is in this state, e.g. 'the thread shows one unread message'; may be empty");
const TestRoleSourceSchema = z
  .enum(TestRoleSourceEnum)
  .describe("CREATED: Muggle signs the account up itself. SUPPLIED: the customer provides the account");
const TestRoleAllowsChangesSchema = z
  .boolean()
  .describe("SUPPLIED only: the customer allows tests to change the account's account-wide facts when a proven way back restores them");

/** Input of muggle-remote-test-chaining-catalog-get. */
export const TestChainingCatalogGetInputSchema = z.object({
  projectId: TestStateProjectIdSchema,
});

/** Input of muggle-remote-test-chaining-settings-update. */
export const TestChainingSettingsUpdateInputSchema = z.object({
  projectId: TestStateProjectIdSchema,
  freshAccountSetStateId: MuggleEntityIdSchema.nullable()
    .optional()
    .describe("Test state ID (UUID) a newly formed account set starts in, e.g. 'New patient'; null clears it"),
  parallelAccountSetLimit: z
    .number()
    .int()
    .min(TEST_STATE_PARALLEL_ACCOUNT_SET_LIMIT_MIN)
    .max(TEST_STATE_PARALLEL_ACCOUNT_SET_LIMIT_MAX)
    .optional()
    .describe(`Most account sets a batch runs at once (default ${TEST_STATE_PARALLEL_ACCOUNT_SET_LIMIT_DEFAULT})`),
});

/** Input of muggle-remote-test-state-create. */
export const TestStateCreateInputSchema = z.object({
  projectId: TestStateProjectIdSchema,
  name: z.string().min(1).describe("State name, unique per project ignoring case, e.g. 'Message unread'"),
  facts: TestStateFactsSchema.optional(),
  check: TestStateCheckSchema.optional(),
});

/** Input of muggle-remote-test-state-update. */
export const TestStateUpdateInputSchema = z.object({
  projectId: TestStateProjectIdSchema,
  stateId: TestStateIdSchema,
  name: z.string().min(1).optional().describe("New state name, unique per project ignoring case"),
  facts: TestStateFactsSchema.optional(),
  check: TestStateCheckSchema.optional(),
});

/** Input of muggle-remote-test-state-delete. */
export const TestStateDeleteInputSchema = z.object({
  projectId: TestStateProjectIdSchema,
  stateId: TestStateIdSchema,
});

/** Input of muggle-remote-test-role-create. */
export const TestRoleCreateInputSchema = z.object({
  projectId: TestStateProjectIdSchema,
  name: z.string().min(1).describe("Role name, unique per project ignoring case, e.g. 'Patient'"),
  source: TestRoleSourceSchema,
  allowsChanges: TestRoleAllowsChangesSchema.optional(),
});

/** Input of muggle-remote-test-role-update. */
export const TestRoleUpdateInputSchema = z.object({
  projectId: TestStateProjectIdSchema,
  roleId: TestRoleIdSchema,
  name: z.string().min(1).optional().describe("New role name, unique per project ignoring case"),
  source: TestRoleSourceSchema.optional(),
  allowsChanges: TestRoleAllowsChangesSchema.optional(),
});

/** Input of muggle-remote-test-role-delete. */
export const TestRoleDeleteInputSchema = z.object({
  projectId: TestStateProjectIdSchema,
  roleId: TestRoleIdSchema,
});

/** Input of muggle-remote-test-chaining-plan-get. */
export const TestChainingPlanGetInputSchema = z.object({
  projectId: TestStateProjectIdSchema,
  isProduction: z
    .boolean()
    .optional()
    .describe("True to plan for production, which runs at the floor with no extra account sets for speed (default false)"),
});

/** Test state fields of muggle-remote-test-case-create and muggle-remote-test-case-update; null clears a field. */
export const TestCaseTestStateFieldsSchema = z.object({
  actsAsRoleIds: z
    .array(MuggleEntityIdSchema)
    .nullable()
    .optional()
    .describe("Test role IDs (UUID) the test acts as, in order; null clears them"),
  prerequisiteStateId: MuggleEntityIdSchema.nullable()
    .optional()
    .describe("Test state ID (UUID) the test needs to start; null clears it"),
  resultStateId: MuggleEntityIdSchema.nullable()
    .optional()
    .describe("Test state ID (UUID) the test leaves when it passes; the prerequisite's ID for an observation; null clears it"),
});
