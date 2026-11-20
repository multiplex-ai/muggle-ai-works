import { z } from "zod";

/**
 * Pagination input schema shared by list tools.
 *
 * The backend honors these params: a list call with no arguments returns the first
 * page of 10 items sorted by creation time (newest first). The response envelope
 * carries `totalCount`, `totalPages`, and `hasMore` so the caller can page forward
 * without guessing when to stop. Out-of-range pages return `data: []` rather than
 * erroring.
 */
export const PaginationInputSchema = z.object({
  page: z
    .number()
    .int()
    .positive()
    .default(1)
    .describe("Page number, 1-based. Defaults to 1 (the first page)."),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(10)
    .describe("Number of items per page. Defaults to 10, max 100."),
  sortBy: z
    .enum(["createdAt", "updatedAt"])
    .default("createdAt")
    .describe("Field to sort by. Defaults to createdAt (stable under concurrent writes)."),
  sortOrder: z
    .enum(["asc", "desc"])
    .default("desc")
    .describe("Sort direction. Defaults to desc (newest first)."),
});
