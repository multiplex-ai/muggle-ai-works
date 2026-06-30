import { getCallerCredentialsAsync, getConfig } from "@muggleai/mcp";

import {
  type BackendClient,
  type BackendRunData,
  type ProjectSummary,
  type StartedRun,
  type StartGenerationInput,
  type TestCaseDetail,
} from "../domain/types.js";

const CLIENT_NAME = "studio-gen-eval";

function baseUrl (): string {
  const cfg = getConfig() as { e2e?: { promptServiceBaseUrl?: string } };
  const url = cfg.e2e?.promptServiceBaseUrl;
  if (!url) throw new Error("config has no e2e.promptServiceBaseUrl");
  return url.replace(/\/+$/, "");
}

async function authHeaders (): Promise<Record<string, string>> {
  const creds = (await getCallerCredentialsAsync()) as { bearerToken?: string; apiKey?: string };
  if (!creds.bearerToken && !creds.apiKey) {
    throw new Error("not authenticated: run `muggle login` first (no token in ~/.muggle-ai)");
  }
  const headers: Record<string, string> = {
    "X-Correlation-Id": `${CLIENT_NAME}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    "X-Client-Service-Name": CLIENT_NAME,
  };
  if (creds.bearerToken) {
    headers["Authorization"] = creds.bearerToken.startsWith("Bearer ") ? creds.bearerToken : `Bearer ${creds.bearerToken}`;
  }
  if (creds.apiKey) headers["x-api-key"] = creds.apiKey;
  return headers;
}

/** Backends wrap payloads as `{ data: ... }` inconsistently; return the inner value when present. */
function unwrap<T> (body: unknown): T {
  if (body !== null && typeof body === "object" && "data" in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

/** Extract a list from a paginated response regardless of which key holds it. */
function asArray<T> (body: unknown): T[] {
  const inner = unwrap<unknown>(body);
  if (Array.isArray(inner)) return inner as T[];
  if (inner !== null && typeof inner === "object") {
    const obj = inner as Record<string, unknown>;
    for (const key of ["items", "results", "projects", "testCases", "data"]) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
  }
  return [];
}

function messageOf (json: unknown, fallback: string): string {
  if (json !== null && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "details"]) {
      if (typeof o[key] === "string") return o[key] as string;
    }
  }
  return fallback;
}

async function request<T> (method: string, pathAndQuery: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl()}${pathAndQuery}`, {
    method: method,
    headers: headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new Error(`${method} ${pathAndQuery} -> ${res.status}: ${messageOf(json, res.statusText)}`);
  }
  return json as T;
}

function str (obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

/**
 * Real backend client over the prompt-service REST API. Auth and base URL come
 * from the same stored login the muggle MCP tools use, so it needs no env vars.
 * Responses are untyped upstream and parsed defensively.
 */
export function createBackendClient (): BackendClient {
  return {
    async listProjects (): Promise<ProjectSummary[]> {
      const body = await request<unknown>("GET", "/v1/protected/muggle-test/projects?page=1&pageSize=100&sortBy=updatedAt&sortOrder=desc");
      return asArray<Record<string, unknown>>(body).map((p) => ({ id: str(p, "id"), name: str(p, "name") }));
    },

    async listTestCasesByProject (projectId: string): Promise<TestCaseDetail[]> {
      const pageSize = 100;
      const all: TestCaseDetail[] = [];
      for (let page = 1; ; page++) {
        const q = `?projectId=${encodeURIComponent(projectId)}&page=${page}&pageSize=${pageSize}`;
        const got = asArray<TestCaseDetail>(await request<unknown>("GET", `/v1/protected/muggle-test/test-cases${q}`));
        all.push(...got);
        if (got.length < pageSize) break;
      }
      return all;
    },

    async getTestCase (testCaseId: string): Promise<TestCaseDetail> {
      const body = await request<unknown>("GET", `/v1/protected/muggle-test/test-cases/${encodeURIComponent(testCaseId)}`);
      return unwrap<TestCaseDetail>(body);
    },

    async startGeneration (input: StartGenerationInput): Promise<StartedRun> {
      const { workflowParams, ...fields } = input;
      const reqBody: Record<string, unknown> = { ...fields, runEnvironmentType: "remote" };
      if (workflowParams && Object.keys(workflowParams).length > 0) reqBody.workflowParams = workflowParams;
      const body = await request<unknown>("POST", "/v1/protected/muggle-test/workflow/test-script/test-script-generation", reqBody);
      const data = unwrap<{ id?: string }>(body);
      if (!data || typeof data.id !== "string") throw new Error("start-generation returned no runtime id");
      return { runtimeId: data.id };
    },

    async getLatestRun (runtimeId: string): Promise<BackendRunData | null> {
      const path = `/v1/protected/muggle-test/workflow/test-script/test-script-generation/${encodeURIComponent(runtimeId)}/run/latest`;
      try {
        const body = await request<unknown>("GET", path);
        return unwrap<BackendRunData>(body) ?? null;
      } catch (err) {
        if (err instanceof Error && / -> 404:/.test(err.message)) return null;
        throw err;
      }
    },

    async cancelRuntime (runtimeId: string): Promise<void> {
      await request<unknown>("POST", `/v1/protected/muggle-test/workflow/runtimes/${encodeURIComponent(runtimeId)}/cancel`);
    },
  };
}
