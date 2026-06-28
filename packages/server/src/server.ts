/**
 * The DeviceFlowServer orchestrates the protocol: create, approve,
 * deny, and consume operations. It delegates storage to a pluggable
 * backend and session issuance to an integrator-supplied callback.
 *
 * Framework-agnostic: it knows nothing about Express, Fastify, or HTTP.
 * Wrappers for specific frameworks live in separate packages.
 */

import {
  transition,
  generateDeviceCode,
  generateUserCode,
  normalizeUserCode,
  assertValidDeviceCode,
} from "@qr-device-flow/core/server";
import {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
  ProtocolError,
  type Challenge,
  type ChallengeEvent,
  type DeviceCodeResponse,
  type RequesterInfo,
} from "@qr-device-flow/core";
import type { ChallengeStorage } from "./storage.js";

/**
 * A session issued by the integrator's auth system once a challenge
 * is approved and consumed. Opaque to the library.
 */
export interface IssuedSession {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresIn?: number;
  readonly [extra: string]: unknown;
}

export interface ServerConfig {
  readonly storage: ChallengeStorage;

  /**
   * The public URL where the mobile app lands when it reads the QR.
   * Used to build verification_uri_complete. Example: "https://app.example.com/connect".
   */
  readonly verificationUri: string;

  /**
   * Called when a challenge reaches approved-consumed. The integrator
   * returns a session for the approved user. This is THE integration
   * point with your existing auth system.
   */
  readonly issueSession: (input: {
    userId: string;
    challenge: Challenge;
  }) => Promise<IssuedSession>;

  /** Optional: override the default TTL. Capped at MAX_TTL_SECONDS. */
  readonly ttlSeconds?: number;

  /** Optional: clock injection for testing. Defaults to Date.now. */
  readonly now?: () => number;
}

export class DeviceFlowServer {
  private readonly cfg: ServerConfig;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(cfg: ServerConfig) {
    const ttl = Math.min(
      cfg.ttlSeconds ?? DEFAULT_TTL_SECONDS,
      MAX_TTL_SECONDS,
    );
    if (ttl <= 0) {
      throw new Error("ttlSeconds must be positive");
    }
    this.cfg = cfg;
    this.ttlMs = ttl * 1000;
    this.now = cfg.now ?? Date.now;
  }

  /**
   * Creates a new challenge. Called when the browser hits the
   * device-authorization endpoint.
   */
  async createChallenge(
    requesterInfo: RequesterInfo = {},
  ): Promise<DeviceCodeResponse> {
    const deviceCode = generateDeviceCode();
    const userCode = generateUserCode();
    const now = this.now();

    const challenge: Challenge = {
      deviceCode,
      userCode,
      status: "pending",
      createdAt: now,
      expiresAt: now + this.ttlMs,
      userId: null,
      requesterInfo,
    };

    await this.cfg.storage.create(challenge);

    const verificationUriComplete =
      this.cfg.verificationUri +
      (this.cfg.verificationUri.includes("?") ? "&" : "?") +
      "user_code=" +
      encodeURIComponent(userCode);

    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: this.cfg.verificationUri,
      verification_uri_complete: verificationUriComplete,
      expires_in: Math.floor(this.ttlMs / 1000),
      interval: MIN_POLL_INTERVAL_SECONDS,
    };
  }

  /**
   * Marks a challenge as scanned (mobile app read the QR, awaiting user
   * confirmation). Optional UX step — safe to skip.
   */
  async markScanned(userCode: string): Promise<void> {
    await this.applyEventByUserCode(userCode, { type: "SCAN" });
  }

  /**
   * Approves a challenge, binding it to a user. Called after the mobile
   * app's consent flow (user reviewed device info, tapped confirm).
   *
   * The userId MUST come from the mobile app's authenticated session,
   * never from request parameters.
   */
  async approve(userCode: string, userId: string): Promise<void> {
    if (!userId) throw new ProtocolError("invalid_transition");
    await this.applyEventByUserCode(userCode, { type: "APPROVE", userId });
  }

  /** Denies a challenge (user rejected the login on mobile). */
  async deny(userCode: string): Promise<void> {
    await this.applyEventByUserCode(userCode, { type: "DENY" });
  }

  /**
   * Called by the browser (via polling or realtime channel) to claim
   * the session once approved. Atomic: only the first caller gets a
   * session, subsequent calls fail with already_consumed.
   */
  async consume(deviceCode: string): Promise<IssuedSession> {
    assertValidDeviceCode(deviceCode);
    const current = await this.fetchOrThrow(deviceCode);

    // Retry loop handles the narrow race where two requests arrive in
    // flight. compareAndSwap detects the loser; we re-read and retry
    // the transition, which will now observe the correct state and
    // surface the right error (or succeed for the rightful consumer).
    let latest = current;
    for (let attempt = 0; attempt < 3; attempt++) {
      const next = transition(latest, { type: "CONSUME" }, this.now());
      const swap = await this.cfg.storage.compareAndSwap(deviceCode, latest, next);
      if (swap.ok) {
        if (!next.userId) {
          // Should never happen: approved always has a userId.
          throw new ProtocolError("invalid_transition");
        }
        return await this.cfg.issueSession({ userId: next.userId, challenge: next });
      }
      if (swap.current === null) {
        throw new ProtocolError("expired_token");
      }
      latest = swap.current;
    }
    // Exhausted retries — concurrent contention on the same code is
    // either a bug or an attack. Fail closed.
    throw new ProtocolError("invalid_transition", "too many concurrent consume attempts");
  }

  /** Read-only status check. Used by polling clients. */
  async getStatus(deviceCode: string): Promise<Challenge> {
    assertValidDeviceCode(deviceCode);
    return await this.fetchOrThrow(deviceCode);
  }

  // ---- internals ----

  private async applyEventByUserCode(
    rawUserCode: string,
    event: ChallengeEvent,
  ): Promise<Challenge | null> {
    const normalized = normalizeUserCode(rawUserCode);
    const display = normalized.slice(0, 4) + "-" + normalized.slice(4);

    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.cfg.storage.getByUserCode(display);
      if (!current) throw new ProtocolError("invalid_user_code");
      const next = transition(current, event, this.now());
      const swap = await this.cfg.storage.compareAndSwap(
        current.deviceCode,
        current,
        next,
      );
      if (swap.ok) return next;
      // else: lost the race, re-read and retry
    }
    throw new ProtocolError("invalid_transition", "too many concurrent updates");
  }

  private async fetchOrThrow(deviceCode: string): Promise<Challenge> {
    const c = await this.cfg.storage.getByDeviceCode(deviceCode);
    if (!c) throw new ProtocolError("expired_token");
    return c;
  }
}
