import type { IPortListenerReading } from "./port-listener-types.js";

/** Reading of a port the platform tool could not inspect. */
export const UNREADABLE_PORT: IPortListenerReading = { isReadable: false, listener: null };

/** Reading of a port nothing listens on. */
export const NOTHING_LISTENING: IPortListenerReading = { isReadable: true, listener: null };

/** Longest a platform tool may take to name a port's listener before the port counts as unreadable. */
export const PORT_LISTENER_COMMAND_TIMEOUT_MS = 15_000;

/** Parent links walked up from a listener: enough for any service tree prepare starts (shell → npm → node). */
export const PORT_LISTENER_MAX_ANCESTORS = 32;
