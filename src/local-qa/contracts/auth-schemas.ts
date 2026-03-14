/**
 * Zod schemas for auth-related tools.
 */

import { z } from "zod";

/**
 * Auth login input schema.
 */
export const AuthLoginInputSchema = z.object({
  waitForCompletion: z.boolean().optional().describe("Whether to wait for browser login completion before returning. Default: true"),
  timeoutMs: z.number().int().positive().min(1000).max(900000).optional().describe("Maximum time to wait for login completion in milliseconds. Default: 120000"),
});

export type AuthLoginInput = z.infer<typeof AuthLoginInputSchema>;

/**
 * Auth poll input schema.
 */
export const AuthPollInputSchema = z.object({
  deviceCode: z.string().optional().describe("Device code from the login response. Optional if a login was recently started."),
});

export type AuthPollInput = z.infer<typeof AuthPollInputSchema>;

/**
 * Empty input schema for tools that take no parameters.
 */
export const EmptyInputSchema = z.object({});

export type EmptyInput = z.infer<typeof EmptyInputSchema>;
