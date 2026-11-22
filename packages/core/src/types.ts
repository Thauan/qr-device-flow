/**
 * Core types for the QR Device Flow protocol.
 *
 * These types are SAFE to share across web, mobile, and server bundles.
 * They carry no runtime logic — TypeScript erases them at build time.
 *
 * Naming follows RFC 8628 (OAuth 2.0 Device Authorization Grant).
 */

/**
 * Lifecycle states of a device authorization challenge.
 *
 * Terminal states: `approved-consumed`, `denied`, `expired`.
 * Once terminal, no further transitions are allowed.
 *
 * The `scanned` state is an extension beyond RFC 8628, used to improve UX
 * (e.g., WhatsApp Web shows "phone detected, confirm on device").
 */
export type ChallengeStatus =
  | "pending" //       QR rendered, not scanned yet
  | "scanned" //       mobile read the QR, awaiting user confirmation
  | "approved" //      user confirmed on mobile, web has not consumed yet
  | "approved-consumed" // web pulled the session, flow complete
  | "denied" //        user rejected on mobile
  | "expired"; //      TTL elapsed without approval

/**
 * A challenge record, as persisted by the authorization server.
 *
 * `deviceCode` is opaque and server-internal — the browser uses it to poll
 * or subscribe for updates, but it must NEVER be shown to the user.
 *
 * `userCode` is short, human-readable, and embedded in the QR's
 * verification URI. It MAY be shown as a typing fallback if the camera fails.
 */
export interface Challenge {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly status: ChallengeStatus;
  readonly createdAt: number; // epoch millis
  readonly expiresAt: number; // epoch millis
  /** Populated once the mobile app binds a user to the challenge. */
  readonly userId: string | null;
  /** Context about the browser that requested the code (shown on mobile for consent). */
  readonly requesterInfo: RequesterInfo;
  /**
   * Two-digit number shown on the browser's login screen. The user must type
   * it on the phone before approving (number matching). Defends against a QR
   * code that was shown to the victim from someone else's screen.
   */
  readonly verificationNumber: string | null;
  /**
   * SHA-256 (hex) of the browser-binding secret. The secret travels only as an
   * HttpOnly cookie to the browser that created the challenge. Null when the
   * challenge was created without a binding (library use outside the HTTP layer).
   */
  readonly bindingHash: string | null;
  /** Wrong verification numbers submitted so far. The challenge is denied at the limit. */
  readonly numberFailures: number;
}

/**
 * Context about the browser requesting login, shown on the mobile
 * device during the consent step. Never trust these fields for auth
 * decisions — they are advisory, for the user's judgment.
 */
export interface RequesterInfo {
  readonly userAgent?: string;
  readonly ip?: string;
  readonly approxLocation?: string; // e.g., "Salvador, BR"
  /**
   * Origin of the page that asked for the login (from the request's Origin header),
   * e.g. "https://app.example.com". Shown on the consent screen so the user can
   * tell which site is asking. Advisory only: it comes from the browser.
   */
  readonly origin?: string;
}

/**
 * Response from the server when the browser requests a new challenge,
 * matching RFC 8628 §3.2.
 *
 * `verificationUriComplete` is the URL encoded into the QR code.
 * `interval` is the minimum poll interval in seconds (for clients using polling).
 */
export interface DeviceCodeResponse {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri: string;
  readonly verification_uri_complete: string;
  readonly expires_in: number; // seconds
  readonly interval: number; // seconds
  /**
   * Two digits, e.g. "07", when the server runs with `verification: "number"`.
   * Null when verification is off (`verification: "none"`).
   */
  readonly verification_number: string | null;
}

/**
 * How the phone confirms a login, decided by the server.
 *
 * - `"number"` (default): the phone must type the two-digit number shown on the browser.
 * - `"none"`: no second check. The consent screen (browser, IP, location) is the only
 *   confirmation. This is weaker against QR code phishing (see THREAT_MODEL.md).
 */
export type VerificationMode = "number" | "none";

/**
 * Events that can be applied to a challenge state, driving transitions.
 * These are the only legal inputs to the state machine.
 */
export type ChallengeEvent =
  | { readonly type: "SCAN" }
  | { readonly type: "APPROVE"; readonly userId: string }
  | { readonly type: "DENY" }
  | { readonly type: "CONSUME" }
  | { readonly type: "EXPIRE" };

/**
 * Protocol-level error codes, following RFC 8628 §3.5 conventions where possible.
 */
export type ProtocolErrorCode =
  | "invalid_transition" //       the event is not legal from the current status
  | "expired_token" //            challenge TTL elapsed
  | "already_consumed" //         web already pulled the session
  | "authorization_denied" //     user explicitly rejected on mobile
  | "authorization_pending" //    polled too early, no decision yet
  | "invalid_user_code" //        format validation failed
  | "invalid_device_code" //      format validation failed
  | "invalid_verification_number" // the number typed on the phone doesn't match
  | "invalid_binding"; //         the request doesn't come from the browser that created the challenge

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  constructor(code: ProtocolErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "ProtocolError";
  }
}
