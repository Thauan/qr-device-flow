/**
 * Public entrypoint: safe to import from web, mobile, and server.
 *
 * Exposes ONLY types and inert constants. No functions that make
 * authorization decisions or handle secrets.
 */

export type {
  Challenge,
  ChallengeStatus,
  ChallengeEvent,
  DeviceCodeResponse,
  RequesterInfo,
  ProtocolErrorCode,
} from "./types.js";

export { ProtocolError } from "./types.js";

export {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
  USER_CODE_LENGTH,
  USER_CODE_PATTERN,
  DEVICE_CODE_PATTERN,
} from "./constants.js";
