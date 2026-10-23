import { SHORT_ID_REFERENCE_PATTERN } from "../../contracts/entity-reference-constants.js";
import { EntityReferenceResolvedFieldEnum, type IEntityReferenceField } from "../../contracts/entity-reference-types.js";
import { GatewayError, McpErrorCode, type ICallerCredentials } from "../../e2e/types.js";
import { getPromptServiceClient } from "../../e2e/upstream-client.js";
import { SHORT_ID_ENTITY_NOUN_BY_TYPE, SHORT_ID_ROUTE_SEGMENT } from "./entity-reference-resolver-constants.js";
import type { IResolveEntityReferencesParams, IShortIdResolution } from "./entity-reference-resolver-types.js";
import { MUGGLE_TEST_PREFIX } from "./upstream-route-constants.js";

/**
 * Replace each short ID in a cloud tool's declared reference fields with the full ID it names in the input's
 * `projectId`.
 *
 * Full IDs pass through with no upstream call.
 *
 * @throws GatewayError when a short ID comes without `projectId`, names another entity type or a deleted entity,
 *   or prompt-service cannot resolve it (its not-found message passes through).
 */
export async function resolveEntityReferencesAsync (
  params: IResolveEntityReferencesParams,
): Promise<Record<string, unknown>> {
  const shortIdFields = params.entityReferenceFields.filter((field) => isShortIdReference(params.input[field.fieldName]));
  if (shortIdFields.length === 0) {
    return params.input;
  }
  const projectId = requireProjectId(params.input, String(params.input[shortIdFields[0].fieldName]));
  const resolvedIds = await Promise.all(shortIdFields.map((field) =>
    resolveFieldAsync({
      field: field,
      shortIdReference: String(params.input[field.fieldName]),
      projectId: projectId,
      credentials: params.credentials,
      correlationId: params.correlationId,
    })));
  const resolvedInput = { ...params.input };
  shortIdFields.forEach((field, index) => {
    resolvedInput[field.fieldName] = resolvedIds[index];
  });
  return resolvedInput;
}

function isShortIdReference (fieldValue: unknown): boolean {
  return typeof fieldValue === "string" && SHORT_ID_REFERENCE_PATTERN.test(fieldValue);
}

// The server cannot know the caller's working directory, so a short ID needs projectId.
function requireProjectId (input: Record<string, unknown>, shortIdReference: string): string {
  if (typeof input.projectId !== "string" || input.projectId === "") {
    throw new GatewayError({
      code: McpErrorCode.INVALID_ARGUMENT,
      message: `Resolving ${shortIdReference} needs projectId`,
    });
  }
  return input.projectId;
}

async function resolveFieldAsync (params: {
  field: IEntityReferenceField;
  shortIdReference: string;
  projectId: string;
  credentials: ICallerCredentials;
  correlationId: string;
}): Promise<string> {
  const response = await getPromptServiceClient().execute<IShortIdResolution>(
    {
      method: "GET",
      path: `${MUGGLE_TEST_PREFIX}/projects/${encodeURIComponent(params.projectId)}/${SHORT_ID_ROUTE_SEGMENT}/${encodeURIComponent(params.shortIdReference)}`,
    },
    params.credentials,
    params.correlationId,
  );
  const resolution = response.data;
  if (resolution.entityType !== params.field.expectedEntityType) {
    throw new GatewayError({
      code: McpErrorCode.INVALID_ARGUMENT,
      message: `${resolution.shortId} is a ${SHORT_ID_ENTITY_NOUN_BY_TYPE[resolution.entityType]}, not a ${SHORT_ID_ENTITY_NOUN_BY_TYPE[params.field.expectedEntityType]}`,
    });
  }
  if (resolution.isDeleted) {
    throw new GatewayError({
      code: McpErrorCode.NOT_FOUND,
      message: `${resolution.shortId} was deleted`,
    });
  }
  const resolvedId = params.field.resolvedIdField === EntityReferenceResolvedFieldEnum.WORKFLOW_RUNTIME_ID
    ? resolution.workflowRuntimeId
    : resolution.entityId;
  if (!resolvedId) {
    throw new GatewayError({
      code: McpErrorCode.UPSTREAM_ERROR,
      message: `${resolution.shortId} resolved without a ${params.field.resolvedIdField}`,
    });
  }
  return resolvedId;
}
