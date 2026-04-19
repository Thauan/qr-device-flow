import type { ChallengeStatus } from "@qr-device-flow/core";
import { MIN_POLL_INTERVAL_SECONDS } from "@qr-device-flow/core";
import type { Transport } from "./types.js";

const TERMINAL_STATES: ReadonlySet<ChallengeStatus> = new Set([
  "approved",
  "approved-consumed",
  "denied",
  "expired",
]);

/**
 * Polls `GET {endpoint}/status?device_code=XXX` at the server-specified
 * interval (clamped to the RFC minimum of 5 seconds).
 */
export class PollingTransport implements Transport {
  private readonly endpoint: string;
  private statusCallback: ((status: ChallengeStatus) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  onStatus(callback: (status: ChallengeStatus) => void): void {
    this.statusCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  connect(deviceCode: string, interval: number): void {
    this.stopped = false;
    const safeInterval = Math.max(interval, MIN_POLL_INTERVAL_SECONDS) * 1000;

    const poll = async (): Promise<void> => {
      if (this.stopped) return;

      try {
        const url = `${this.endpoint}/status?device_code=${encodeURIComponent(deviceCode)}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Poll failed with HTTP ${res.status}`);
        }
        const body = (await res.json()) as { status: ChallengeStatus };
        this.statusCallback?.(body.status);

        if (TERMINAL_STATES.has(body.status)) {
          return; // stop polling on terminal states
        }
      } catch (err) {
        this.errorCallback?.(err instanceof Error ? err : new Error(String(err)));
      }

      if (!this.stopped) {
        this.timerId = setTimeout(poll, safeInterval);
      }
    };

    // Start first poll immediately
    void poll();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}
