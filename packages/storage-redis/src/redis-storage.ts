/**
 * Redis-backed implementation of ChallengeStorage.
 *
 * Uses two key families:
 *   {prefix}dc:{deviceCode}  -> JSON-serialized Challenge (main record)
 *   {prefix}uc:{userCode}    -> deviceCode string (index for userCode lookups)
 *
 * Both keys carry a Redis TTL derived from `challenge.expiresAt`, so Redis
 * auto-cleans expired records. A 60-second grace period is added to allow
 * consumption right at the expiration boundary.
 *
 * Atomic compare-and-swap is implemented via an inline Lua script.
 */

import type { Redis } from "ioredis";
import type { Challenge } from "@qr-device-flow/core";

// ---------------------------------------------------------------------------
// Lua script inlined as a constant (no filesystem reads at runtime)
// ---------------------------------------------------------------------------

const CAS_LUA = `
local current = redis.call('GET', KEYS[1])
if not current then return 'NIL' end

local obj = cjson.decode(current)
local expectedUserId = ARGV[2]
if expectedUserId == '' then expectedUserId = nil end

if obj.status ~= ARGV[1] or obj.userId ~= expectedUserId then
  return current
end

redis.call('SET', KEYS[1], ARGV[3], 'KEEPTTL')
return 'OK'
`;

// ---------------------------------------------------------------------------
// Public config type
// ---------------------------------------------------------------------------

export interface RedisStorageConfig {
  /** ioredis client instance */
  redis: Redis;
  /** Key prefix for all keys, default "qrdf:" */
  prefix?: string;
}

// ---------------------------------------------------------------------------
// ChallengeStorage interface (structural — no import from server package)
// ---------------------------------------------------------------------------

export interface ChallengeStorage {
  create(challenge: Challenge): Promise<void>;
  getByDeviceCode(deviceCode: string): Promise<Challenge | null>;
  getByUserCode(userCode: string): Promise<Challenge | null>;
  compareAndSwap(
    deviceCode: string,
    expected: Challenge,
    next: Challenge,
  ): Promise<{ ok: true } | { ok: false; current: Challenge | null }>;
  purgeExpired(now: number): Promise<number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Grace period added on top of the calculated TTL (seconds). */
const GRACE_SECONDS = 60;

/**
 * Compute the Redis TTL in seconds for a challenge, based on its `expiresAt`.
 * Returns at least 1 so we never SET without an expiration.
 */
function ttlSeconds(challenge: Challenge): number {
  const seconds = Math.ceil((challenge.expiresAt - Date.now()) / 1000) + GRACE_SECONDS;
  return Math.max(seconds, 1);
}

// ---------------------------------------------------------------------------
// RedisStorage
// ---------------------------------------------------------------------------

export class RedisStorage implements ChallengeStorage {
  private readonly redis: Redis;
  private readonly prefix: string;

  constructor(config: RedisStorageConfig) {
    this.redis = config.redis;
    this.prefix = config.prefix ?? "qrdf:";
  }

  // -- key helpers ----------------------------------------------------------

  private dcKey(deviceCode: string): string {
    return `${this.prefix}dc:${deviceCode}`;
  }

  private ucKey(userCode: string): string {
    return `${this.prefix}uc:${userCode}`;
  }

  // -- ChallengeStorage methods ---------------------------------------------

  async create(challenge: Challenge): Promise<void> {
    const ttl = ttlSeconds(challenge);
    const json = JSON.stringify(challenge);

    // SET NX — fail if the device code key already exists
    const result = await this.redis.set(
      this.dcKey(challenge.deviceCode),
      json,
      "EX",
      ttl,
      "NX",
    );

    if (result === null) {
      throw new Error(
        `Challenge with deviceCode "${challenge.deviceCode}" already exists`,
      );
    }

    // User code index (overwrite is fine — codes should be unique)
    await this.redis.set(
      this.ucKey(challenge.userCode),
      challenge.deviceCode,
      "EX",
      ttl,
    );
  }

  async getByDeviceCode(deviceCode: string): Promise<Challenge | null> {
    const raw = await this.redis.get(this.dcKey(deviceCode));
    if (raw === null) return null;
    return JSON.parse(raw) as Challenge;
  }

  async getByUserCode(userCode: string): Promise<Challenge | null> {
    const deviceCode = await this.redis.get(this.ucKey(userCode));
    if (deviceCode === null) return null;
    return this.getByDeviceCode(deviceCode);
  }

  async compareAndSwap(
    deviceCode: string,
    expected: Challenge,
    next: Challenge,
  ): Promise<{ ok: true } | { ok: false; current: Challenge | null }> {
    const result = (await this.redis.eval(
      CAS_LUA,
      1,
      this.dcKey(deviceCode),
      expected.status,
      expected.userId ?? "",
      JSON.stringify(next),
    )) as string;

    if (result === "OK") {
      return { ok: true };
    }

    if (result === "NIL") {
      return { ok: false, current: null };
    }

    // Mismatch — result contains the current JSON
    return { ok: false, current: JSON.parse(result) as Challenge };
  }

  /**
   * No-op: Redis TTL handles expiration automatically.
   */
  async purgeExpired(_now: number): Promise<number> {
    return 0;
  }
}
