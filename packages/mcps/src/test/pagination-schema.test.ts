/**
 * Tests for PaginationInputSchema and the list-tool input schemas that merge it.
 *
 * Covers the design doc contract (see designs/list-endpoint-pagination.md):
 *   - defaults: page=1, pageSize=10, sortBy=createdAt, sortOrder=desc
 *   - pageSize capped at 100
 *   - page must be a positive integer
 *   - sortBy and sortOrder are constrained enums
 */

import { describe, expect, it } from "vitest";

import {
  PaginationInputSchema,
  ProjectListInputSchema,
  UseCaseListInputSchema,
  TestCaseListInputSchema,
  TestScriptListInputSchema,
} from "../mcp/e2e/contracts/index.js";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("PaginationInputSchema", () => {
  it("applies all four defaults when nothing is provided", () => {
    const parsed = PaginationInputSchema.parse({});
    expect(parsed).toEqual({
      page: 1,
      pageSize: 10,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
  });

  it("rejects pageSize > 100", () => {
    expect(() => PaginationInputSchema.parse({ pageSize: 200 })).toThrow();
    expect(() => PaginationInputSchema.parse({ pageSize: 101 })).toThrow();
  });

  it("accepts pageSize up to the 100 cap", () => {
    const parsed = PaginationInputSchema.parse({ pageSize: 100 });
    expect(parsed.pageSize).toBe(100);
  });

  it("rejects page=0 and negative pages", () => {
    expect(() => PaginationInputSchema.parse({ page: 0 })).toThrow();
    expect(() => PaginationInputSchema.parse({ page: -1 })).toThrow();
  });

  it("rejects non-integer page", () => {
    expect(() => PaginationInputSchema.parse({ page: 1.5 })).toThrow();
  });

  it("rejects unknown sortBy values", () => {
    expect(() => PaginationInputSchema.parse({ sortBy: "bogus" })).toThrow();
    expect(() => PaginationInputSchema.parse({ sortBy: "name" })).toThrow();
  });

  it("accepts the two legal sortBy values", () => {
    expect(PaginationInputSchema.parse({ sortBy: "createdAt" }).sortBy).toBe("createdAt");
    expect(PaginationInputSchema.parse({ sortBy: "updatedAt" }).sortBy).toBe("updatedAt");
  });

  it("rejects unknown sortOrder values", () => {
    expect(() => PaginationInputSchema.parse({ sortOrder: "ascending" })).toThrow();
  });

  it("accepts the two legal sortOrder values", () => {
    expect(PaginationInputSchema.parse({ sortOrder: "asc" }).sortOrder).toBe("asc");
    expect(PaginationInputSchema.parse({ sortOrder: "desc" }).sortOrder).toBe("desc");
  });

  it("preserves explicit overrides", () => {
    const parsed = PaginationInputSchema.parse({
      page: 3,
      pageSize: 25,
      sortBy: "updatedAt",
      sortOrder: "asc",
    });
    expect(parsed).toEqual({
      page: 3,
      pageSize: 25,
      sortBy: "updatedAt",
      sortOrder: "asc",
    });
  });
});

describe("list tool schemas inherit pagination defaults", () => {
  it("ProjectListInputSchema applies pagination defaults with no input", () => {
    const parsed = ProjectListInputSchema.parse({});
    expect(parsed).toMatchObject({
      page: 1,
      pageSize: 10,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
  });

  it("UseCaseListInputSchema applies pagination defaults alongside required filters", () => {
    const parsed = UseCaseListInputSchema.parse({ projectId: VALID_UUID });
    expect(parsed).toMatchObject({
      projectId: VALID_UUID,
      page: 1,
      pageSize: 10,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
  });

  it("TestCaseListInputSchema applies pagination defaults alongside required filters", () => {
    const parsed = TestCaseListInputSchema.parse({ projectId: VALID_UUID });
    expect(parsed).toMatchObject({
      projectId: VALID_UUID,
      page: 1,
      pageSize: 10,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
  });

  it("TestScriptListInputSchema applies pagination defaults alongside optional filters", () => {
    const parsed = TestScriptListInputSchema.parse({ projectId: VALID_UUID });
    expect(parsed).toMatchObject({
      projectId: VALID_UUID,
      page: 1,
      pageSize: 10,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
  });

  it("list schemas still reject invalid pagination params", () => {
    expect(() => ProjectListInputSchema.parse({ pageSize: 500 })).toThrow();
    expect(() =>
      UseCaseListInputSchema.parse({ projectId: VALID_UUID, sortBy: "priority" })
    ).toThrow();
  });
});
