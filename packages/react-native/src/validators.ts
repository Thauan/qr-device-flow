/**
 * Runtime JSON validation type guards for React Native mobile client.
 *
 * These functions provide type safety by validating the structure of JSON
 * responses from the server before they are used in the mobile app.
 */

import type { RequesterInfo } from "@qr-device-flow/core";

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
