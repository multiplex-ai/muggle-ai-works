import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { STUDIO_AUTH_FILENAME } from "./constants";
import { type MuggleSession, type StudioUserProfile } from "./types";

const REQUIRED_SESSION_FIELDS: (keyof MuggleSession)[] = ["userId", "email", "accessToken"];

/**
 * Maps the local muggle session onto the profile studio expects.
 *
 * Studio does not take tokens from this file to authenticate: given a profile it
 * performs its own client-credentials grant with the client secret it ships. The
 * file supplies identity, which is why the refresh token — the long-lived secret
 * — is deliberately not copied into it.
 *
 * Output shape: `{ userId: "auth0|…", nickname: "you@example.com",
 * email: "you@example.com", sessionId: "", firebaseSessionToken: "",
 * accessToken: "…" }`
 *
 * @throws When the session lacks a field studio identifies the user by; every
 * missing field is named at once so a stale session is diagnosed in one read.
 */
export const buildStudioUserProfile = (session: Partial<MuggleSession>): StudioUserProfile => {
  const missingFields = REQUIRED_SESSION_FIELDS.filter((field) => !session[field]);
  if (missingFields.length > 0) {
    throw new Error(
      `Muggle session is missing required field(s): ${missingFields.join(", ")}. Run \`muggle login\`.`,
    );
  }

  return {
    userId: session.userId!,
    nickname: session.email!,
    email: session.email!,
    sessionId: "",
    firebaseSessionToken: "",
    accessToken: session.accessToken!,
  };
};

/**
 * Writes studio's auth file for this batch into a private temp directory.
 *
 * Kept out of the report tree on purpose: the profile carries an access token,
 * and a report directory is something a person copies, zips, or attaches to a
 * PR. The caller is responsible for removing it — see `removeStudioAuthFile`.
 *
 * Output shape: an absolute path to the written file.
 *
 * @param sessionFilePath - The muggle session to read identity from.
 */
export const writeStudioAuthFile = (sessionFilePath: string): string => {
  const session = JSON.parse(fs.readFileSync(sessionFilePath, "utf8")) as Partial<MuggleSession>;
  const profile = buildStudioUserProfile(session);

  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-bench-auth-"));
  const authFilePath = path.join(authDir, STUDIO_AUTH_FILENAME);
  fs.writeFileSync(authFilePath, JSON.stringify(profile), { encoding: "utf8", mode: 0o600 });
  return authFilePath;
};

/** Removes the auth file and its directory. Best-effort: a batch must not fail on cleanup. */
export const removeStudioAuthFile = (authFilePath: string): void => {
  try {
    fs.rmSync(path.dirname(authFilePath), { recursive: true, force: true });
  } catch {
    // A leftover file in the OS temp directory is not worth failing a batch over.
  }
};
