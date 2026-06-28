import type { ChallengeStatus } from "@qr-device-flow/core";
import { TERMINAL_STATES } from "@qr-device-flow/core";
import type { StatusMessage } from "../types/messages.js";
import { isStatusMessage } from "../types/validators.js";
import type { Transport } from "./types.js";

/**
 * Uses a native `WebSocket` to connect to
 * `{endpoint}/ws?device_code=XXX`, where the `http(s)` scheme is
 * replaced with `ws(s)`.
 *
 * Expects JSON messages of the shape `{ "status": ChallengeStatus }`.
 * Includes simple reconnection logic with exponential back-off
 * (up to 3 retries).
 */
export class WebSocketTransport implements Transport {
  private readonly endpoint: string;
  private statusCallback: ((status: ChallengeStatus) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  private ws: WebSocket | null = null;
  private stopped = false;
  private retries = 0;
  private readonly maxRetries = 3;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  onStatus(callback: (status: ChallengeStatus) => void): void {
    this.statusCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  connect(deviceCode: string, _interval: number): void {
    this.stopped = false;
    this.retries = 0;
    this.openSocket(deviceCode);
  }

  private openSocket(deviceCode: string): void {
    if (this.stopped) return;

    const wsEndpoint = this.endpoint
      .replace(/^https:/, "wss:")
      .replace(/^http:/, "ws:");
    const url = `${wsEndpoint}/ws?device_code=${encodeURIComponent(deviceCode)}`;

    this.ws = new WebSocket(url);

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        if (!isStatusMessage(data)) {
          throw new Error("Invalid status message: missing or invalid status field");
        }
        this.statusCallback?.(data.status);

        if (TERMINAL_STATES.has(data.status)) {
          this.disconnect();
        }
      } catch (err) {
        this.errorCallback?.(err instanceof Error ? err : new Error(String(err)));
      }
    };

    this.ws.onerror = () => {
      // onerror is always followed by onclose, so reconnection is handled there
    };

    this.ws.onclose = () => {
      if (this.stopped) return;

      if (this.retries < this.maxRetries) {
        this.retries++;
        const delay = Math.min(1000 * 2 ** this.retries, 10_000);
        this.reconnectTimer = setTimeout(() => this.openSocket(deviceCode), delay);
      } else {
        this.errorCallback?.(
          new Error("WebSocket connection failed after maximum retries"),
        );
      }
    };
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
