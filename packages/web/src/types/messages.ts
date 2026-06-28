import type { ChallengeStatus } from "@qr-device-flow/core";

/**
 * Status message received from the server during polling/SSE/WebSocket.
 */
export interface StatusMessage {
  readonly status: ChallengeStatus;
}

/**
 * Session payload returned after the server consumes an approved challenge.
 */
export interface SessionResponsePayload {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
}
