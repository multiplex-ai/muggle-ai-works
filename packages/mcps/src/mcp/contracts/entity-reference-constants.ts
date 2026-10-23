/**
 * The short-ID grammar prompt-service accepts: a type prefix, an optional hyphen or single space, and a number
 * from 1 up, ignoring case, leading zeros and surrounding whitespace (`tc 042` means `TC-42`).
 */
export const SHORT_ID_REFERENCE_PATTERN = /^\s*(UC|TC|TS|R)[-\s]?0*([1-9]\d*)\s*$/i;

/** Validation message for an entity reference that is neither a full ID nor a short ID. */
export const ENTITY_REFERENCE_INVALID_MESSAGE = "Expected a full ID or a short ID such as TC-42";
