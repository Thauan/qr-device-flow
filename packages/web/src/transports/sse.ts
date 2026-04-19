import type { ChallengeStatus } from "@qr-device-flow/core";
import type { Transport } from "./types.js";

const TERMINAL_STATES: ReadonlySet<ChallengeStatus> = new Set([
  "approved",
  "approved-consumed",
  "denied",
  "expired",
]);

/**
 * Uses `EventSource` (Server-Sent Events) to subscribe to
 * `{endpoint}/events?device_code=XXX`.
 *
 * Expects the server to send events named `"status"` with a JSON
 * data payload of `{ "status": ChallengeStatus }`.
 */
export class SSETransport implements Transport {
  private readonly endpoint: string;
  private statusCallback: ((status: ChallengeStatus) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  private eventSource: EventSource | null = null;

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
    const url = `${this.endpoint}/events?device_code=${encodeURIComponent(deviceCode)}`;
    this.eventSource = new EventSource(url);

    this.eventSource.addEventListener("status", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as { status: ChallengeStatus };
        this.statusCallback?.(data.status);

        if (TERMINAL_STATES.has(data.status)) {
          this.disconnect();
        }
      } catch (err) {
        this.errorCallback?.(err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.eventSource.onerror = () => {
      this.errorCallback?.(new Error("SSE connection error"));
      this.disconnect();
    };
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}
