/**
 * Runtime JSON validation type guards for Challenge storage.
 *
 * These functions validate Challenge objects as they are serialized/deserialized
 * from Redis, ensuring data integrity and preventing corruption.
 */

import type {
  Challenge,
  ChallengeStatus,
  RequesterInfo,
} from "@qr-device-flow/core";

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
 * Type guard for RequesterInfo.
 *
 * Validates optional fields that provide context about the requesting browser:
 * - `userAgent`: browser user agent string
 * - `ip`: requesting IP address
 * - `approxLocation`: approximate geographic location
 *
 * All fields are advisory and must NOT be used for security decisions.
 */
function isRequesterInfo(data: unknown): data is RequesterInfo {
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
 * Type guard for Challenge objects (from storage or server state).
 *
 * Validates the complete Challenge shape, used primarily in storage
 * layers (e.g., Redis) where Challenge objects are serialized/deserialized.
 */
export function isChallenge(data: unknown): data is Challenge {
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
