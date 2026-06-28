/**
 * Runtime JSON validation type guards for API responses.
 *
 * These functions provide type safety by validating the structure of JSON
 * responses from the server before they are used. This ensures that responses
 * conform to the expected schema and prevents bugs from malformed or
 * unexpected server responses.
 */

import type {
  ChallengeStatus,
  DeviceCodeResponse,
  RequesterInfo,
} from "@qr-device-flow/core";
import type { StatusMessage, SessionResponsePayload } from "./messages.js";

/**
 * Valid ChallengeStatus values for runtime validation.
 */
const VALID_CHALLENGE_STATUSES = new Set<ChallengeStatus>([
  "pending",
  "scanned",
  "approved",
  "approved-consumed",
  "denied",
  "expired",
]);

/**
 * Validates that a value is a string and a valid ChallengeStatus.
 */
function isChallengeStatus(value: unknown): value is ChallengeStatus {
  return typeof value === "string" && VALID_CHALLENGE_STATUSES.has(value as ChallengeStatus);
}

/**
 * Type guard for StatusMessage.
 *
 * Validates: `{ status: ChallengeStatus }`
 *
 * Used by polling, SSE, and WebSocket transports to parse status updates.
 */
export function isStatusMessage(data: unknown): data is StatusMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "status" in data &&
    isChallengeStatus((data as any).status)
  );
}

/**
 * Type guard for DeviceCodeResponse (RFC 8628 §3.2).
 *
 * Validates all required fields:
 * - `device_code`: opaque string for server lookups
 * - `user_code`: human-readable code
 * - `verification_uri`: URI template for manual entry
 * - `verification_uri_complete`: full QR-encoded URI
 * - `expires_in`: TTL in seconds
 * - `interval`: minimum poll interval in seconds
 */
export function isDeviceCodeResponse(data: unknown): data is DeviceCodeResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "device_code" in data &&
    typeof (data as any).device_code === "string" &&
    (data as any).device_code.length > 0 &&
    "user_code" in data &&
    typeof (data as any).user_code === "string" &&
    (data as any).user_code.length > 0 &&
    "verification_uri" in data &&
    typeof (data as any).verification_uri === "string" &&
    (data as any).verification_uri.length > 0 &&
    "verification_uri_complete" in data &&
    typeof (data as any).verification_uri_complete === "string" &&
    (data as any).verification_uri_complete.length > 0 &&
    "expires_in" in data &&
    typeof (data as any).expires_in === "number" &&
    (data as any).expires_in > 0 &&
    "interval" in data &&
    typeof (data as any).interval === "number" &&
    (data as any).interval > 0
  );
}

/**
 * Type guard for SessionResponsePayload.
 *
 * Validates: `{ access_token: string, refresh_token?: string, expires_in?: number }`
 *
 * Used when consuming an approved challenge to extract the session tokens.
 */
export function isSessionResponsePayload(data: unknown): data is SessionResponsePayload {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const obj = data as any;

  // access_token is required
  if (!("access_token" in obj) || typeof obj.access_token !== "string" || obj.access_token.length === 0) {
    return false;
  }

  // refresh_token is optional but must be a string if present
  if ("refresh_token" in obj && typeof obj.refresh_token !== "string") {
    return false;
  }

  // expires_in is optional but must be a positive number if present
  if ("expires_in" in obj && (typeof obj.expires_in !== "number" || obj.expires_in <= 0)) {
    return false;
  }

  return true;
}

/**
 * Type guard for RequesterInfo.
 *
 * Validates optional fields that provide context about the requesting browser:
 * - `userAgent`: browser user agent string
 * - `ip`: requesting IP address
 * - `approxLocation`: approximate geographic location
 *
 * All fields are advisory and must NOT be used for security decisions.
 */
export function isRequesterInfo(data: unknown): data is RequesterInfo {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const obj = data as any;

  // Validate all fields are strings if present
  if ("userAgent" in obj && typeof obj.userAgent !== "string") {
    return false;
  }

  if ("ip" in obj && typeof obj.ip !== "string") {
    return false;
  }

  if ("approxLocation" in obj && typeof obj.approxLocation !== "string") {
    return false;
  }

  return true;
}

/**
 * Type guard for the response from `/scan` endpoint (fetchChallengeDetails).
 *
 * Validates:
 * - `requester_info`: RequesterInfo object
 * - `expires_at`: TTL timestamp in milliseconds
 */
export function isChallengeDetailsResponse(
  data: unknown,
): data is { requester_info: RequesterInfo; expires_at: number } {
  return (
    typeof data === "object" &&
    data !== null &&
    "requester_info" in data &&
    isRequesterInfo((data as any).requester_info) &&
    "expires_at" in data &&
    typeof (data as any).expires_at === "number" &&
    (data as any).expires_at > 0
  );
}

/**
 * Type guard for Challenge objects (from storage or server state).
 *
 * Validates the complete Challenge shape, used primarily in storage
 * layers (e.g., Redis) where Challenge objects are serialized/deserialized.
 */
export function isChallenge(data: unknown): data is {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly status: ChallengeStatus;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly userId: string | null;
  readonly requesterInfo: RequesterInfo;
} {
  return (
    typeof data === "object" &&
    data !== null &&
    "deviceCode" in data &&
    typeof (data as any).deviceCode === "string" &&
    (data as any).deviceCode.length > 0 &&
    "userCode" in data &&
    typeof (data as any).userCode === "string" &&
    (data as any).userCode.length > 0 &&
    "status" in data &&
    isChallengeStatus((data as any).status) &&
    "createdAt" in data &&
    typeof (data as any).createdAt === "number" &&
    (data as any).createdAt > 0 &&
    "expiresAt" in data &&
    typeof (data as any).expiresAt === "number" &&
    (data as any).expiresAt > 0 &&
    "userId" in data &&
    ((data as any).userId === null || typeof (data as any).userId === "string") &&
    "requesterInfo" in data &&
    isRequesterInfo((data as any).requesterInfo)
  );
}
