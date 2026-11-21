import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Redis from "ioredis";
import type { Challenge } from "@qr-device-flow/core";
import { RedisStorage } from "../src/redis-storage.js";

// Runs the real Lua CAS script against a real Redis. The unit tests mock
// Redis in JavaScript, so they cannot catch Lua-specific bugs (such as
// cjson decoding JSON null as a sentinel instead of nil).
//
//   REDIS_URL=redis://localhost:6379 npm test
//
// Skipped when REDIS_URL is not set.

const REDIS_URL = process.env.REDIS_URL;

function challenge(overrides: Partial<Challenge> = {}): Challenge {
  const now = Date.now();
  return {
    deviceCode: `dc-${Math.random().toString(36).slice(2)}`,
    userCode: "ABCD-EFGH",
    status: "pending",
    createdAt: now,
    expiresAt: now + 60_000,
    userId: null,
    requesterInfo: {},
    ...overrides,
  };
}

describe.skipIf(!REDIS_URL)("RedisStorage (real Redis, Lua CAS)", () => {
  let redis: Redis;
  let storage: RedisStorage;
  const prefix = `test-${Date.now()}:`;

  beforeAll(() => {
    redis = new Redis(REDIS_URL!, { lazyConnect: false, maxRetriesPerRequest: 1 });
    storage = new RedisStorage({ redis, prefix });
  });

  afterAll(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
    redis.disconnect();
  });

  it("swaps a pending challenge (userId is null) to scanned", async () => {
    const c = challenge();
    await storage.create(c);

    const result = await storage.compareAndSwap(c.deviceCode, c, { ...c, status: "scanned" });

    expect(result).toEqual({ ok: true });
    expect((await storage.getByDeviceCode(c.deviceCode))?.status).toBe("scanned");
  });

  it("swaps a scanned challenge to approved with a userId", async () => {
    const c = challenge({ status: "scanned" });
    await storage.create(c);

    const result = await storage.compareAndSwap(c.deviceCode, c, {
      ...c,
      status: "approved",
      userId: "alice",
    });

    expect(result).toEqual({ ok: true });
    expect((await storage.getByDeviceCode(c.deviceCode))?.userId).toBe("alice");
  });

  it("rejects a swap when the expected status is stale, and returns the current record", async () => {
    const c = challenge();
    await storage.create(c);
    await storage.compareAndSwap(c.deviceCode, c, { ...c, status: "scanned" });

    const stale = await storage.compareAndSwap(c.deviceCode, c, { ...c, status: "denied" });

    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.current?.status).toBe("scanned");
  });

  it("returns current: null when the challenge no longer exists", async () => {
    const c = challenge();
    const result = await storage.compareAndSwap(c.deviceCode, c, { ...c, status: "scanned" });
    expect(result).toEqual({ ok: false, current: null });
  });
});
