/**
 * Protocol constants. These are SAFE to share across bundles —
 * they are inert numbers and strings, not decisions.
 *
 * All durations are in seconds unless noted otherwise.
 */

import type { ChallengeStatus } from "./types";

/**
 * Default challenge lifetime. RFC 8628 says "short-lived"; we pick 120s
 * as a balance between UX (user has time to pick up their phone) and
 * phishing window limitation.
 */
export const DEFAULT_TTL_SECONDS = 120;

/**
 * Hard ceiling on challenge TTL, not overridable by integrators.
 * Anything longer is a security smell — see §5.2 of the RFC.
 */
export const MAX_TTL_SECONDS = 600;

/**
 * Minimum interval between polling requests from the browser client.
 * RFC 8628 §3.2 mandates this value be returned; clients SHOULD honor it.
 */
export const MIN_POLL_INTERVAL_SECONDS = 5;

/**
 * Length of the user_code (excluding dash separator).
 * 8 chars from a 22-char alphabet = ~35.7 bits of entropy,
 * more than adequate for a short-lived code bound to an IP.
 */
export const USER_CODE_LENGTH = 8;

/**
 * Alphabet used for user_code generation. Characters that are visually
 * ambiguous across fonts are EXCLUDED: 0/O, 1/I/L, and lowercase (case
 * confusion). This matters when the user types the code as a fallback.
 */
export const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 chars, no 0/O/1/I/L

/**
 * Length of device_code in bytes of entropy before base64url encoding.
 * 32 bytes = 256 bits, the standard for opaque session identifiers.
 */
export const DEVICE_CODE_BYTES = 32;

/**
 * Regex matching a well-formed user_code (with optional dash in the middle).
 * Codes are rendered as "ABCD-EFGH" for readability but may be submitted
 * without the dash.
 */
export const USER_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-?[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

/**
 * Regex matching a well-formed device_code — 43 chars of base64url (from 32 bytes).
 */
export const DEVICE_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Challenge states that represent the end of a flow (no further transitions allowed).
 */
export const TERMINAL_STATES: ReadonlySet<ChallengeStatus> = new Set([
  "approved",
  "approved-consumed",
  "denied",
  "expired",
]);
