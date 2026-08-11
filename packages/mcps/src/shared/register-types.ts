/** Why a registration attempt ended the way it did. */
export enum RegisterOutcome {
  Created = "created",
  AlreadyRegistered = "already-registered",
  Throttled = "throttled",
}

/** Body the registration endpoint returns when it creates an account. */
export interface IRegisterCreatedResponse {
  userId: string;
  email: string;
  plan: string;
  emailVerified: boolean;
  apiKey: string;
  tokensGranted: number;
  tokensOnVerification: number;
}

/**
 * Result of a registration attempt, already reduced to what the tool reports.
 *
 * Output shape (created):
 * `{ outcome: "created", userId: "auth0|…", email: "a@b.com", plan: "free",
 *    emailVerified: false, tokensGranted: 100000, tokensOnVerification: 1000000,
 *    credentialStored: true }`
 */
export interface IRegisterResult {
  outcome: RegisterOutcome;
  userId?: string;
  email?: string;
  plan?: string;
  emailVerified?: boolean;
  tokensGranted?: number;
  tokensOnVerification?: number;
  /** Whether the returned key was persisted for later tool calls. */
  credentialStored?: boolean;
  retryAfterSeconds?: number;
  message: string;
}
