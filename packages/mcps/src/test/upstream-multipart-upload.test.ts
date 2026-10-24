/**
 * Tests for how upstream calls reach the wire: a file upload arrives as a multipart file part
 * the backend's multer `upload.single("file")` can read, and a JSON call is still sent as JSON.
 */

import { createServer, IncomingMessage, Server } from "node:http";
import { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const upstreamTarget = vi.hoisted(() => ({ baseUrl: "" }));

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({
    logLevel: "silent",
    serverName: "test",
    serverVersion: "0.0.0",
    e2e: {
      promptServiceBaseUrl: upstreamTarget.baseUrl,
      requestTimeoutMs: 5000,
      workflowTimeoutMs: 5000,
    },
  }),
}));

vi.mock("../shared/logger.js", () => {
  const noop = () => undefined;
  const fakeLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    verbose: noop,
    silly: noop,
    child: () => fakeLogger,
  };
  return {
    getLogger: () => fakeLogger,
    createChildLogger: () => fakeLogger,
    resetLogger: noop,
  };
});

interface IReceivedUpstreamRequest {
  contentType: string;
  body: Buffer;
}

const PRD_UPLOAD_PATH = "/v1/protected/muggle-test/workflow/use-case/prd-file-upload";

const receivedRequests: IReceivedUpstreamRequest[] = [];
let upstreamServer: Server;

const readRequestBodyAsync = async (request: IncomingMessage): Promise<Buffer> => {
  const bodyChunks: Buffer[] = [];
  for await (const bodyChunk of request) {
    bodyChunks.push(bodyChunk as Buffer);
  }
  return Buffer.concat(bodyChunks);
};

beforeAll(async () => {
  upstreamServer = createServer(async (request, response) => {
    receivedRequests.push({
      contentType: request.headers["content-type"] ?? "",
      body: await readRequestBodyAsync(request),
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: "ok" }));
  });
  await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
  upstreamTarget.baseUrl = `http://127.0.0.1:${(upstreamServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
});

const sendPostAsync = async (callFields: Record<string, unknown>): Promise<IReceivedUpstreamRequest> => {
  const { PromptServiceClient } = await import("../mcp/e2e/upstream-client.js");
  receivedRequests.length = 0;
  await new PromptServiceClient().execute(
    { method: "POST", path: PRD_UPLOAD_PATH, ...callFields } as never,
    { bearerToken: "token" } as never,
    "correlation-1",
  );
  return receivedRequests[0];
};

const readUploadedFileAsync = async (receivedRequest: IReceivedUpstreamRequest): Promise<File> => {
  const uploadForm = await new Response(receivedRequest.body, {
    headers: { "Content-Type": receivedRequest.contentType },
  }).formData();
  return uploadForm.get("file") as File;
};

describe("upstream multipart upload", () => {
  it("sends a file upload as a multipart file part", async () => {
    const prdMarkdown = "# PRD: Recurring Test Schedules\n\n1. A user can pause a schedule.\n";

    const receivedRequest = await sendPostAsync({
      multipartFormData: {
        fileFieldName: "file",
        fileName: "prd-test-schedules.md",
        contentType: "text/markdown",
        fileBase64: Buffer.from(prdMarkdown).toString("base64"),
      },
    });

    expect(receivedRequest.contentType).toMatch(/^multipart\/form-data; boundary=/);
    const uploadedFile = await readUploadedFileAsync(receivedRequest);
    expect(uploadedFile.name).toBe("prd-test-schedules.md");
    expect(uploadedFile.type).toBe("text/markdown");
    expect(await uploadedFile.text()).toBe(prdMarkdown);
  });

  it("keeps binary file bytes intact", async () => {
    const docxBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80, 0x0d, 0x0a]);

    const receivedRequest = await sendPostAsync({
      multipartFormData: {
        fileFieldName: "file",
        fileName: "prd.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileBase64: docxBytes.toString("base64"),
      },
    });

    const uploadedFile = await readUploadedFileAsync(receivedRequest);
    expect(Buffer.from(await uploadedFile.arrayBuffer())).toEqual(docxBytes);
  });

  it("still sends a JSON call as JSON", async () => {
    const receivedRequest = await sendPostAsync({ body: { name: "Checkout" } });

    expect(receivedRequest.contentType).toBe("application/json");
    expect(JSON.parse(receivedRequest.body.toString("utf8"))).toEqual({ name: "Checkout" });
  });
});
