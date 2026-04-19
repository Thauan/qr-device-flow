/**
 * Storage contract for challenge persistence.
 *
 * Integrators provide an implementation backed by Redis, Postgres, Dynamo,
 * or whatever their stack uses. The server core depends ONLY on this
 * interface — never on a specific storage.
 *
 * The critical guarantee: `compareAndSwap` must be atomic. Without it,
 * race conditions can cause double-consumption, lost denials, or
 * re-approval with a different userId. All production implementations
 * must use the underlying storage's native atomic primitives:
 *   - Redis: WATCH/MULTI/EXEC or Lua scripts
 *   - Postgres: SELECT ... FOR UPDATE inside a transaction, or optimistic
 *     locking on a version column
 *   - DynamoDB: ConditionExpression with the previous status
 */

import type { Challenge } from "@qr-device-flow/core";

export interface ChallengeStorage {
  /**
   * Persists a freshly created challenge. MUST fail if the deviceCode
   * already exists (prevents collisions from retries).
   */
  create(challenge: Challenge): Promise<void>;

  /**
   * Looks up by deviceCode (the long opaque token used by the browser).
   * Returns null if not found or already purged.
   */
  getByDeviceCode(deviceCode: string): Promise<Challenge | null>;

  /**
   * Looks up by userCode (the short code the mobile app reads from the QR).
   * Returns null if not found.
   */
  getByUserCode(userCode: string): Promise<Challenge | null>;

  /**
   * Atomically replaces `expected` with `next` only if the current
   * persisted value equals `expected`. Returns the actual stored value
   * after the attempt (either `next` on success, or the current stored
   * value if someone else won the race).
   *
   * The server uses this to detect races and retry or fail cleanly.
   */
  compareAndSwap(
    deviceCode: string,
    expected: Challenge,
    next: Challenge,
  ): Promise<{ ok: true } | { ok: false; current: Challenge | null }>;

  /**
   * Optional: explicit cleanup of expired records. Implementations using
   * TTL-aware stores (Redis EXPIRE, Dynamo TTL) may leave this as a no-op.
   */
  purgeExpired(now: number): Promise<number>;
}
