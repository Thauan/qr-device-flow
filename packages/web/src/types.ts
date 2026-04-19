import type { ChallengeStatus } from "@qr-device-flow/core";

/**
 * Transport strategy used to monitor challenge status changes.
 *
 * - `"polling"` — periodic HTTP GET (works everywhere, default)
 * - `"sse"` — Server-Sent Events (efficient, unidirectional)
 * - `"websocket"` — WebSocket (bidirectional, lowest latency)
 */
export type TransportType = "polling" | "sse" | "websocket";

/**
 * Configuration for the {@link QRDeviceFlow} client.
 */
export interface QRDeviceFlowOptions {
  /** Base URL of the device-flow server (e.g. `"https://api.example.com/device"`). */
  endpoint: string;

  /** Transport strategy. Defaults to `"polling"`. */
  transport?: TransportType;

  /** Called whenever the challenge status changes. */
  onStateChange?: (status: ChallengeStatus) => void;

  /** Called once the challenge is approved and the session has been consumed. */
  onApproved?: (session: ApprovedSession) => void;

  /** Called on unrecoverable errors (network failures, protocol errors). */
  onError?: (error: Error) => void;

  /**
   * When `true`, automatically creates a new challenge after the current
   * one expires. Defaults to `false`.
   */
  autoRegenerate?: boolean;

  /** QR code size in pixels. Defaults to `256`. */
  qrSize?: number;
}

/**
 * Session payload returned after the server consumes an approved challenge.
 */
export interface ApprovedSession {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

/**
 * Result from {@link QRDeviceFlow.startHeadless}, containing everything
 * needed to render a QR code without touching the DOM.
 */
export interface HeadlessResult {
  /** Data URL of the QR code SVG (`data:image/svg+xml;base64,...`). */
  qrDataUrl: string;

  /** Human-readable user code (e.g. `"ABCD-EFGH"`). */
  userCode: string;

  /** Opaque device code for server lookups. */
  deviceCode: string;

  /** Epoch-millisecond timestamp when this challenge expires. */
  expiresAt: number;
}
