/**
 * Headless account registration for @muggleai/works.
 * Creates a Muggle AI account from agent-supplied credentials and stores the key it returns.
 */

import axios from "axios";

import { saveApiKey } from "./api-key.js";
import { getConfig } from "./config.js";
import { getInstallId } from "./install_id.js";
import { getLogger } from "./logger.js";
import {
  IRegisterCreatedResponse,
  IRegisterResult,
  RegisterOutcome,
} from "./register-types.js";

/** Status the endpoint uses for an address that already has an account. */
const CONFLICT_STATUS = 409;

/** Status the endpoint uses when a registration throttle refused the attempt. */
const THROTTLED_STATUS = 429;

/**
 * Register a new Muggle AI account and persist the credential it hands back.
 *
 * The install id is sent so the service can throttle on it alongside the client address; it is
 * the same id the rest of the tooling already reports, so a caller cannot dodge the limit by
 * reinstalling without also changing address.
 *
 * @param email - Address to register.
 * @param userProvidedPassword - Password chosen by the caller; sent once and never stored locally.
 * @returns What happened, and — when an account was created — the plan and starter allowance.
 */
export async function registerAccount(
  email: string,
  userProvidedPassword: string,
): Promise<IRegisterResult> {
  const logger = getLogger();
  const config = getConfig();
  const registerUrl = `${config.e2e.promptServiceBaseUrl}/v1/public/auth/register`;

  try {
    const response = await axios.post<IRegisterCreatedResponse>(
      registerUrl,
      {
        email: email,
        password: userProvidedPassword,
        installId: getInstallId(),
      },
      { headers: { "Content-Type": "application/json" } },
    );

    const created = response.data;
    saveApiKey({ apiKey: created.apiKey, apiKeyId: created.userId });

    logger.info("[Register] Account created and credential stored", {
      userId: created.userId,
      plan: created.plan,
    });

    return {
      outcome: RegisterOutcome.Created,
      userId: created.userId,
      email: created.email,
      plan: created.plan,
      emailVerified: created.emailVerified,
      tokensGranted: created.tokensGranted,
      tokensOnVerification: created.tokensOnVerification,
      credentialStored: true,
      message:
        `Account created on the ${created.plan} plan and the API key stored — ` +
        `remote tools will use it automatically. ${created.tokensGranted.toLocaleString()} tokens ` +
        `are available now; verify ${created.email} to raise that to ` +
        `${created.tokensOnVerification.toLocaleString()}.`,
    };
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;

    if (status === CONFLICT_STATUS) {
      return {
        outcome: RegisterOutcome.AlreadyRegistered,
        message:
          "An account already exists for this email. Use muggle-remote-auth-login to sign in instead.",
      };
    }

    if (status === THROTTLED_STATUS) {
      const retryAfterSeconds = axios.isAxiosError(error)
        ? (error.response?.data as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds
        : undefined;
      return {
        outcome: RegisterOutcome.Throttled,
        retryAfterSeconds: retryAfterSeconds,
        message: retryAfterSeconds
          ? `Too many registrations from this machine. Try again in ${retryAfterSeconds} seconds.`
          : "Too many registrations from this machine. Try again later.",
      };
    }

    logger.error("[Register] Registration failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
