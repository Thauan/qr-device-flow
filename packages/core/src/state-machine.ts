/**
 * Pure state machine for the QR device flow challenge lifecycle.
 *
 * SECURITY NOTE: this module is exported via `@qr-device-flow/core/server`
 * and must NEVER be imported into web or mobile bundles. It does not make
 * authorization decisions on its own (the authoritative storage does), but
 * shipping it to clients is unnecessary and expands the attack surface for
 * no benefit.
 *
 * The `transition` function is deterministic and side-effect-free. Given
 * the same current state and event, it always returns the same next state
 * (or the same error). Callers are expected to persist the result atomically.
 */

import type { Challenge, ChallengeEvent, ChallengeStatus } from "./types.js";
import { ProtocolError } from "./types.js";

/**
 * Applies an event to a challenge and returns the next state.
 *
 * Throws ProtocolError for any illegal transition. Callers should catch
 * and map to an HTTP response (or equivalent transport error).
 *
 * The `now` parameter is injected rather than read from `Date.now()` so
 * that transitions are pure and deterministic under test.
 */
export function transition(
  current: Challenge,
  event: ChallengeEvent,
  now: number,
): Challenge {
  // Expiration is checked first: a challenge past its TTL cannot accept
  // ANY event except the synthetic EXPIRE event (which just records the
  // terminal state). This prevents race conditions where an APPROVE arrives
  // milliseconds after expiration.
  if (current.status !== "expired" && now >= current.expiresAt) {
    if (event.type === "EXPIRE") {
      return { ...current, status: "expired" };
    }
    throw new ProtocolError("expired_token");
  }

  // CONSUME needs to report specific error codes per terminal state
  // (so the web client can distinguish "already logged in" from "user
  // denied" from "still waiting"). Handle it before the generic terminal
  // check below.
  if (event.type === "CONSUME") {
    switch (current.status) {
      case "approved":
        return { ...current, status: "approved-consumed" };
      case "approved-consumed":
        throw new ProtocolError("already_consumed");
      case "denied":
        throw new ProtocolError("authorization_denied");
      case "expired":
        throw new ProtocolError("expired_token");
      case "pending":
      case "scanned":
        throw new ProtocolError("authorization_pending");
    }
  }

  // Terminal states are sticky for every other event. No transition out.
  if (isTerminal(current.status)) {
    throw new ProtocolError(
      "invalid_transition",
      `challenge is already in terminal state: ${current.status}`,
    );
  }

  // At this point, `event` is narrowed: CONSUME was handled above.
  const remaining = event as Exclude<ChallengeEvent, { type: "CONSUME" }>;

  switch (remaining.type) {
    case "SCAN": {
      if (current.status !== "pending") {
        throw new ProtocolError(
          "invalid_transition",
          `SCAN not allowed from ${current.status}`,
        );
      }
      return { ...current, status: "scanned" };
    }

    case "APPROVE": {
      // Both `pending` and `scanned` can be approved — the mobile app
      // might approve without the server seeing a prior SCAN event
      // (e.g., when using polling transport where SCAN is not reported).
      if (current.status !== "pending" && current.status !== "scanned") {
        throw new ProtocolError(
          "invalid_transition",
          `APPROVE not allowed from ${current.status}`,
        );
      }
      if (!remaining.userId || remaining.userId.length === 0) {
        throw new ProtocolError(
          "invalid_transition",
          "APPROVE requires a userId",
        );
      }
      return { ...current, status: "approved", userId: remaining.userId };
    }

    case "DENY": {
      if (current.status !== "pending" && current.status !== "scanned") {
        throw new ProtocolError(
          "invalid_transition",
          `DENY not allowed from ${current.status}`,
        );
      }
      return { ...current, status: "denied" };
    }

    case "EXPIRE": {
      return { ...current, status: "expired" };
    }
  }
}

export function isTerminal(status: ChallengeStatus): boolean {
  return (
    status === "approved-consumed" ||
    status === "denied" ||
    status === "expired"
  );
}
