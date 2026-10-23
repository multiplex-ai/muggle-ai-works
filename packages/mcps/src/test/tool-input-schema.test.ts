import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildToolInputJsonSchema } from "../shared/tool-input-schema/tool-input-schema.js";

describe("buildToolInputJsonSchema", () => {
  it("drops the root $schema dialect", () => {
    const jsonSchema = buildToolInputJsonSchema(z.object({ name: z.string() }));

    expect(jsonSchema).not.toHaveProperty("$schema");
    expect(jsonSchema).toMatchObject({ type: "object", required: ["name"] });
  });

  it("drops Zod's regex beside a uuid or email format and keeps the format", () => {
    const jsonSchema = buildToolInputJsonSchema(z.object({ projectId: z.string().uuid(), contactEmail: z.email() }));

    expect(jsonSchema.properties).toEqual({
      projectId: { type: "string", format: "uuid" },
      contactEmail: { type: "string", format: "email" },
    });
  });

  it("keeps a custom regex, alone or combined with a format", () => {
    const jsonSchema = buildToolInputJsonSchema(
      z.object({ paymentMethodId: z.string().regex(/^pm_/), prefixedUuid: z.string().uuid().regex(/^0/) }),
    );
    const properties = jsonSchema.properties as Record<string, { pattern?: string; allOf?: Array<{ pattern: string }> }>;

    expect(properties.paymentMethodId.pattern).toBe("^pm_");
    expect(properties.prefixedUuid.allOf?.map((branch) => branch.pattern)).toContain("^0");
    expect(properties.prefixedUuid.allOf).toHaveLength(2);
  });

  it("drops the safe-integer bounds on an integer and keeps real bounds", () => {
    const jsonSchema = buildToolInputJsonSchema(
      z.object({ anyCount: z.number().int(), pageSize: z.number().int().min(1).max(100), timeoutMs: z.number().int().positive() }),
    );

    expect(jsonSchema.properties).toEqual({
      anyCount: { type: "integer" },
      pageSize: { type: "integer", minimum: 1, maximum: 100 },
      timeoutMs: { type: "integer", exclusiveMinimum: 0 },
    });
  });

  it("compacts nested objects, arrays, and unions", () => {
    const jsonSchema = buildToolInputJsonSchema(
      z.object({
        pinnedAccount: z.object({ emailSecretId: z.string().uuid() }).nullable().optional(),
        testCaseIds: z.array(z.string().uuid()),
      }),
    );

    expect(JSON.stringify(jsonSchema)).not.toContain("[0-9a-fA-F]");
    expect(jsonSchema.properties).toMatchObject({
      testCaseIds: { type: "array", items: { type: "string", format: "uuid" } },
    });
  });

  it("keeps properties that share a keyword's name", () => {
    const jsonSchema = buildToolInputJsonSchema(
      z.object({ format: z.literal("uuid"), pattern: z.string(), maximum: z.number(), minimum: z.number() }),
    );

    expect(Object.keys(jsonSchema.properties as object)).toEqual(["format", "pattern", "maximum", "minimum"]);
  });
});
