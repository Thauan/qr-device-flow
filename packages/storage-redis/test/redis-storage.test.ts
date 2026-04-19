import { describe, it, expect, beforeEach } from "vitest";
import type { Challenge } from "@qr-device-flow/core";
import { RedisStorage } from "../src/redis-storage.js";

// ---------------------------------------------------------------------------
// Mock Redis client
//
// Simulates the subset of ioredis commands used by RedisStorage:
//   get, set (with EX / NX flags), eval (Lua CAS script)
// ---------------------------------------------------------------------------

interface StoredEntry {
  value: string;
  expiresAtMs: number | null; // null = no TTL
}

class MockRedis {
  private store = new Map<string, StoredEntry>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs !== null && Date.now() > entry.expiresAtMs) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  /**
   * Simplified SET that handles the flag combos RedisStorage uses:
   *   set(key, value, "EX", ttl)
   *   set(key, value, "EX", ttl, "NX")
   */
  async set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<string | null> {
    let ex: number | null = null;
    let nx = false;
    let keepTtl = false;

    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]).toUpperCase();
      if (arg === "EX") {
        ex = Number(args[++i]);
      } else if (arg === "NX") {
        nx = true;
      } else if (arg === "KEEPTTL") {
        keepTtl = true;
      }
    }

    if (nx) {
      const existing = await this.get(key);
      if (existing !== null) return null; // key already exists
    }

    let expiresAtMs: number | null = null;
    if (keepTtl) {
      const existing = this.store.get(key);
      expiresAtMs = existing?.expiresAtMs ?? null;
    } else if (ex !== null) {
      expiresAtMs = Date.now() + ex * 1000;
    }

    this.store.set(key, { value, expiresAtMs });
    return "OK";
  }

  /**
   * Minimal Lua script evaluator that runs the CAS logic inline.
   * We replicate the exact semantics of the Lua script used by RedisStorage.
   */
  async eval(
    _script: string,
    _numkeys: number,
    key: string,
    expectedStatus: string,
    expectedUserId: string,
    nextJson: string,
  ): Promise<string> {
    const current = await this.get(key as string);
    if (current === null) return "NIL";

    const obj = JSON.parse(current) as Challenge;
    const uid = expectedUserId === "" ? null : expectedUserId;

    if (obj.status !== expectedStatus || obj.userId !== uid) {
      return current;
    }

    // Preserve TTL (KEEPTTL semantics)
    const entry = this.store.get(key as string);
    this.store.set(key as string, {
      value: nextJson,
      expiresAtMs: entry?.expiresAtMs ?? null,
    });
    return "OK";
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeChallenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    deviceCode: "dc-1234",
    userCode: "UC-5678",
    status: "pending",
    createdAt: Date.now(),
    expiresAt: Date.now() + 300_000, // 5 minutes from now
    userId: null,
    requesterInfo: { userAgent: "test-agent", ip: "127.0.0.1" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RedisStorage", () => {
  let redis: MockRedis;
  let storage: RedisStorage;

  beforeEach(() => {
    redis = new MockRedis();
    // Cast through unknown because MockRedis only implements the subset we need
    storage = new RedisStorage({ redis: redis as unknown as import("ioredis").Redis });
  });

  // -- create ---------------------------------------------------------------

  it("create stores challenge and sets user code index", async () => {
    const challenge = makeChallenge();
    await storage.create(challenge);

    const retrieved = await storage.getByDeviceCode(challenge.deviceCode);
    expect(retrieved).toEqual(challenge);

    // User code index should resolve to the same challenge
    const byUserCode = await storage.getByUserCode(challenge.userCode);
    expect(byUserCode).toEqual(challenge);
  });

  it("create fails on duplicate deviceCode (NX semantics)", async () => {
    const challenge = makeChallenge();
    await storage.create(challenge);

    await expect(storage.create(challenge)).rejects.toThrow(
      /already exists/,
    );
  });

  // -- getByDeviceCode ------------------------------------------------------

  it("getByDeviceCode returns stored challenge", async () => {
    const challenge = makeChallenge();
    await storage.create(challenge);

    const result = await storage.getByDeviceCode(challenge.deviceCode);
    expect(result).toEqual(challenge);
  });

  it("getByDeviceCode returns null for unknown key", async () => {
    const result = await storage.getByDeviceCode("nonexistent");
    expect(result).toBeNull();
  });

  // -- getByUserCode --------------------------------------------------------

  it("getByUserCode returns challenge via index lookup", async () => {
    const challenge = makeChallenge();
    await storage.create(challenge);

    const result = await storage.getByUserCode(challenge.userCode);
    expect(result).toEqual(challenge);
  });

  // -- compareAndSwap -------------------------------------------------------

  it("compareAndSwap succeeds when status and userId match", async () => {
    const challenge = makeChallenge({ status: "pending", userId: null });
    await storage.create(challenge);

    const next: Challenge = { ...challenge, status: "scanned" };
    const result = await storage.compareAndSwap(
      challenge.deviceCode,
      challenge,
      next,
    );

    expect(result).toEqual({ ok: true });

    // Verify the record was updated
    const stored = await storage.getByDeviceCode(challenge.deviceCode);
    expect(stored).toEqual(next);
  });

  it("compareAndSwap fails when status differs (returns current)", async () => {
    const challenge = makeChallenge({ status: "pending" });
    await storage.create(challenge);

    // Pretend we expected "scanned" but it is still "pending"
    const wrongExpected: Challenge = { ...challenge, status: "scanned" };
    const next: Challenge = { ...challenge, status: "approved", userId: "u1" };

    const result = await storage.compareAndSwap(
      challenge.deviceCode,
      wrongExpected,
      next,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.current).toEqual(challenge);
    }
  });

  it("compareAndSwap returns null when key is gone", async () => {
    const challenge = makeChallenge();
    // Do NOT create it — key does not exist

    const next: Challenge = { ...challenge, status: "scanned" };
    const result = await storage.compareAndSwap(
      challenge.deviceCode,
      challenge,
      next,
    );

    expect(result).toEqual({ ok: false, current: null });
  });

  // -- purgeExpired ---------------------------------------------------------

  it("purgeExpired returns 0 (no-op, Redis TTL handles it)", async () => {
    const challenge = makeChallenge();
    await storage.create(challenge);

    const purged = await storage.purgeExpired(Date.now());
    expect(purged).toBe(0);
  });
});
