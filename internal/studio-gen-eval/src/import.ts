import { bodyHash } from "./golden-set.js";
import {
  type BackendClient,
  type GoldenCase,
  type GoldenSet,
  type TestCaseDetail,
} from "./types.js";

/** Map a backend test case onto a generation-ready golden case, computing its snapshot hash. */
export function toGoldenCase (projectId: string, tc: TestCaseDetail): GoldenCase {
  const partial = {
    testCaseId: tc.id,
    useCaseId: tc.useCaseId ?? "",
    projectId: projectId,
    title: tc.title || tc.id,
    url: tc.url ?? "",
    goal: tc.goal || tc.title || "",
    precondition: tc.precondition ?? "",
    instructions: tc.instructions || tc.description || "",
    expectedResult: tc.expectedResult ?? "",
  };
  return { ...partial, bodyHash: bodyHash(partial) };
}

/**
 * Cold-start a golden set from one project: list its test cases, hydrate each to
 * full detail, and snapshot the generation-relevant fields. Returns the set;
 * the caller persists it.
 */
export async function importProject (client: BackendClient, projectId: string): Promise<GoldenSet> {
  const listed = await client.listTestCasesByProject(projectId);
  const full = await Promise.all(listed.map((t) => client.getTestCase(t.id)));
  const cases = full.map((t) => toGoldenCase(projectId, t));
  return {
    sourceProjectId: projectId,
    importedAt: new Date().toISOString(),
    cases: cases,
  };
}

/** Live snapshot hashes for the golden set's cases, for drift detection before a batch. */
export async function liveHashes (client: BackendClient, set: GoldenSet): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const fetched = await Promise.all(set.cases.map((c) => client.getTestCase(c.testCaseId)));
  for (const tc of fetched) {
    out.set(tc.id, toGoldenCase(set.sourceProjectId, tc).bodyHash);
  }
  return out;
}
