import axios from 'axios';
import type { TestCaseRef } from '@muggleai/workflows';
import type { QAAgentDeps, TestCaseRunResult } from '@muggleai/agents';

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 120_000;

function getMuggleApiBaseUrl(): string {
  return process.env['MUGGLE_API_URL'] ?? 'https://api.muggle-ai.com';
}

async function triggerTestCaseRun(
  apiKey: string,
  testCaseId: string,
): Promise<string> {
  const baseUrl = getMuggleApiBaseUrl();
  const url = `${baseUrl}/v1/protected/muggle-test/test-cases/${testCaseId}/runs`;

  const response = await axios.post<{ runId: string }>(url, {}, {
    headers: { 'x-api-key': apiKey },
  });

  return response.data.runId;
}

interface TestCaseRunStatus {
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: 'passed' | 'failed';
  failureReason?: string;
  reproSteps?: string;
}

async function pollTestCaseRun(
  apiKey: string,
  runId: string,
): Promise<TestCaseRunStatus> {
  const baseUrl = getMuggleApiBaseUrl();
  const url = `${baseUrl}/v1/protected/muggle-test/test-case-runs/${runId}`;

  const response = await axios.get<TestCaseRunStatus>(url, {
    headers: { 'x-api-key': apiKey },
  });

  return response.data;
}

async function waitForTestCaseRun(
  apiKey: string,
  runId: string,
): Promise<TestCaseRunResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const run = await pollTestCaseRun(apiKey, runId);

    if (run.status === 'completed') {
      if (run.result === 'passed') {
        return { passed: true };
      }
      return {
        passed: false,
        reason: run.failureReason,
        repro: run.reproSteps,
      };
    }

    if (run.status === 'failed') {
      return {
        passed: false,
        reason: run.failureReason,
        repro: run.reproSteps,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return {
    passed: false,
    reason: `Timed out after ${POLL_TIMEOUT_MS / 1000}s waiting for test case run ${runId}`,
  };
}

export function createQADeps(muggleApiKey: string, projectId: string): QAAgentDeps {
  // projectId is used by createFetchAllTestCases; kept here for API symmetry
  void projectId;

  return {
    runTestCase: async (testCase: TestCaseRef): Promise<TestCaseRunResult> => {
      try {
        const runId = await triggerTestCaseRun(muggleApiKey, testCase.id);
        return await waitForTestCaseRun(muggleApiKey, runId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[qa-impl] runTestCase(${testCase.id}) error: ${message}\n`);
        return { passed: false, reason: `Test runner error: ${message}` };
      }
    },
  };
}

interface TestCaseApiResponse {
  id: string;
  useCase: string;
  description: string;
}

export function createFetchAllTestCases(
  muggleApiKey: string,
  projectId: string,
): () => Promise<TestCaseRef[]> {
  return async (): Promise<TestCaseRef[]> => {
    try {
      const baseUrl = getMuggleApiBaseUrl();
      const url = `${baseUrl}/v1/protected/muggle-test/projects/${projectId}/test-cases`;

      const response = await axios.get<TestCaseApiResponse[]>(url, {
        headers: { 'x-api-key': muggleApiKey },
      });

      return response.data.map((tc) => ({
        id: tc.id,
        useCase: tc.useCase,
        description: tc.description,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[qa-impl] fetchAllTestCases error: ${message}\n`);
      return [];
    }
  };
}
