/**
 * Server-Sent Events stream for one challenge.
 *
 * The browser subscribes once and receives `event: status` messages as the
 * challenge changes, instead of polling. The server checks storage on an
 * interval (default 1 s), emits only when the status actually changes, and
 * closes the stream on a terminal state or after expiry.
 *
 * Framework-agnostic: it writes to a `StatusStreamSink`. The Express wiring
 * lives in `./express.ts`.
 */

import {
  ProtocolError,
  TERMINAL_STATES,
  type Challenge,
  type ChallengeStatus,
} from "@qr-device-flow/core";
import type { DeviceFlowServer } from "./server.js";

export interface StatusStreamSink {
  /** Writes a raw SSE chunk to the client. */
  write(chunk: string): void;
  /** Ends the response. */
  end(): void;
  /** Registers a listener for the client going away. */
  onClose(listener: () => void): void;
}

export interface StatusStreamOptions {
  /** How often storage is checked for changes. Default 1000 ms. */
  pollIntervalMs?: number;
  /** Comment ping that keeps proxies from closing idle streams. Default 15000 ms. */
  heartbeatIntervalMs?: number;
}

/**
 * The status a client should see. The server does not rewrite stored
 * challenges when their TTL passes, so expiry is derived here.
 */
export function effectiveStatus(challenge: Challenge, nowMs: number): ChallengeStatus {
  if (!TERMINAL_STATES.has(challenge.status) && nowMs >= challenge.expiresAt) {
    return "expired";
  }
  return challenge.status;
}

export function streamChallengeStatus(
  server: DeviceFlowServer,
  deviceCode: string,
  sink: StatusStreamSink,
  opts: StatusStreamOptions = {},
): void {
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 15_000;

  let last: ChallengeStatus | null = null;
  let done = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stopTimers = (): void => {
    if (pollTimer !== null) clearTimeout(pollTimer);
    if (heartbeat !== null) clearInterval(heartbeat);
    pollTimer = null;
    heartbeat = null;
  };

  const finish = (): void => {
    if (done) return;
    done = true;
    stopTimers();
    sink.end();
  };

  sink.onClose(() => {
    done = true;
    stopTimers();
  });

  const emit = (status: ChallengeStatus): void => {
    if (status === last) return;
    last = status;
    sink.write(`event: status\ndata: ${JSON.stringify({ status })}\n\n`);
  };

  const tick = async (): Promise<void> => {
    if (done) return;

    let status: ChallengeStatus;
    try {
      const challenge = await server.getStatus(deviceCode);
      status = effectiveStatus(challenge, Date.now());
    } catch (err) {
      if (err instanceof ProtocolError && err.code === "expired_token") {
        // The record is gone (TTL reached in storage): the challenge is over.
        status = "expired";
      } else {
        // Transient storage failure: try again on the next tick.
        if (!done) pollTimer = setTimeout(tick, pollIntervalMs);
        return;
      }
    }

    if (done) return;
    emit(status);

    if (TERMINAL_STATES.has(status)) {
      finish();
      return;
    }
    pollTimer = setTimeout(tick, pollIntervalMs);
  };

  heartbeat = setInterval(() => {
    if (!done) sink.write(": ping\n\n");
  }, heartbeatIntervalMs);

  void tick();
}
