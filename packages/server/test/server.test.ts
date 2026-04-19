import { describe, it, expect, beforeEach } from "vitest";
import { DeviceFlowServer, type IssuedSession } from "../src/index.js";
import { MemoryStorage } from "../src/storage/memory.js";
import { ProtocolError } from "@qr-device-flow/core";

// A controllable clock for deterministic TTL tests.
class FakeClock {
  t = 1_700_000_000_000;
  now = () => this.t;
  advance(ms: number) { this.t += ms; }
}

function setup(config: { ttl?: number } = {}) {
  const storage = new MemoryStorage();
  const clock = new FakeClock();
  let issueCalls = 0;
  const server = new DeviceFlowServer({
    storage,
    verificationUri: "https://app.example.com/connect",
    ttlSeconds: config.ttl ?? 120,
    now: clock.now,
    issueSession: async ({ userId }): Promise<IssuedSession> => {
      issueCalls++;
      return {
        accessToken: `token-for-${userId}`,
        refreshToken: `refresh-for-${userId}`,
        expiresIn: 3600,
      };
    },
  });
  return { server, storage, clock, issueCount: () => issueCalls };
}

describe("DeviceFlowServer: createChallenge", () => {
  it("returns an RFC 8628-shaped response", async () => {
    const { server } = setup();
    const res = await server.createChallenge();
    expect(res.device_code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(res.verification_uri).toBe("https://app.example.com/connect");
    expect(res.verification_uri_complete).toContain("user_code=");
    expect(res.expires_in).toBe(120);
    expect(res.interval).toBe(5);
  });

  it("each challenge is distinct", async () => {
    const { server } = setup();
    const a = await server.createChallenge();
    const b = await server.createChallenge();
    expect(a.device_code).not.toBe(b.device_code);
    expect(a.user_code).not.toBe(b.user_code);
  });

  it("respects requesterInfo for later display on mobile", async () => {
    const { server, storage } = setup();
    const res = await server.createChallenge({
      userAgent: "Chrome/120",
      ip: "8.8.8.8",
      approxLocation: "Salvador, BR",
    });
    const stored = await storage.getByDeviceCode(res.device_code);
    expect(stored?.requesterInfo.userAgent).toBe("Chrome/120");
    expect(stored?.requesterInfo.approxLocation).toBe("Salvador, BR");
  });

  it("caps ttl at MAX_TTL_SECONDS (600)", async () => {
    const { server } = setup({ ttl: 99999 });
    const res = await server.createChallenge();
    expect(res.expires_in).toBeLessThanOrEqual(600);
  });
});

describe("DeviceFlowServer: happy path", () => {
  it("create → scan → approve → consume yields a session", async () => {
    const { server, issueCount } = setup();
    const res = await server.createChallenge();

    await server.markScanned(res.user_code);
    await server.approve(res.user_code, "user-42");
    const session = await server.consume(res.device_code);

    expect(session.accessToken).toBe("token-for-user-42");
    expect(session.refreshToken).toBe("refresh-for-user-42");
    expect(issueCount()).toBe(1);
  });

  it("fast path: create → approve → consume (no scan event)", async () => {
    const { server } = setup();
    const res = await server.createChallenge();
    await server.approve(res.user_code, "user-7");
    const session = await server.consume(res.device_code);
    expect(session.accessToken).toBe("token-for-user-7");
  });

  it("accepts user_code with or without dash, lowercase, surrounding spaces", async () => {
    const { server } = setup();
    const res = await server.createChallenge();
    const raw = res.user_code.replace("-", "").toLowerCase();
    await server.approve(`  ${raw}  `, "u1");
    const session = await server.consume(res.device_code);
    expect(session.accessToken).toBe("token-for-u1");
  });
});

describe("DeviceFlowServer: polling behavior", () => {
  it("getStatus before approval returns pending", async () => {
    const { server } = setup();
    const res = await server.createChallenge();
    const status = await server.getStatus(res.device_code);
    expect(status.status).toBe("pending");
  });

  it("consume before approval throws authorization_pending", async () => {
    const { server } = setup();
    const res = await server.createChallenge();
    try {
      await server.consume(res.device_code);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProtocolError);
      expect((err as ProtocolError).code).toBe("authorization_pending");
    }
  });

  it("consume after denial throws authorization_denied", async () => {
    const { server } = setup();
    const res = await server.createChallenge();
    await server.deny(res.user_code);
    try {
      await server.consume(res.device_code);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ProtocolError).code).toBe("authorization_denied");
    }
  });
});

describe("DeviceFlowServer: single-use semantics", () => {
  it("second consume throws already_consumed (no second session)", async () => {
    const { server, issueCount } = setup();
    const res = await server.createChallenge();
    await server.approve(res.user_code, "user-1");
    await server.consume(res.device_code); // first succeeds

    try {
      await server.consume(res.device_code);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ProtocolError).code).toBe("already_consumed");
    }
    expect(issueCount()).toBe(1); // session was issued EXACTLY once
  });

  it("cannot re-approve with a different user after first approval", async () => {
    const { server } = setup();
    const res = await server.createChallenge();
    await server.approve(res.user_code, "user-1");
    await expect(server.approve(res.user_code, "user-2"))
      .rejects.toBeInstanceOf(ProtocolError);
  });
});

describe("DeviceFlowServer: expiration", () => {
  it("consume after TTL throws expired_token", async () => {
    const { server, clock } = setup({ ttl: 60 });
    const res = await server.createChallenge();
    await server.approve(res.user_code, "user-1");

    clock.advance(61_000); // past TTL

    try {
      await server.consume(res.device_code);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ProtocolError).code).toBe("expired_token");
    }
  });

  it("approve after TTL throws expired_token", async () => {
    const { server, clock } = setup({ ttl: 60 });
    const res = await server.createChallenge();

    clock.advance(61_000);

    try {
      await server.approve(res.user_code, "user-1");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ProtocolError).code).toBe("expired_token");
    }
  });

  it("purgeExpired removes old challenges", async () => {
    const { server, storage, clock } = setup({ ttl: 60 });
    await server.createChallenge();
    await server.createChallenge();
    expect(storage._size()).toBe(2);

    clock.advance(61_000);
    const removed = await storage.purgeExpired(clock.now());
    expect(removed).toBe(2);
    expect(storage._size()).toBe(0);
  });
});

describe("DeviceFlowServer: malformed input", () => {
  it("consume with an invalid device_code throws invalid_device_code", async () => {
    const { server } = setup();
    try {
      await server.consume("not-a-real-code");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ProtocolError).code).toBe("invalid_device_code");
    }
  });

  it("approve with a malformed user_code throws invalid_user_code", async () => {
    const { server } = setup();
    try {
      await server.approve("0000-0000", "u1");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ProtocolError).code).toBe("invalid_user_code");
    }
  });

  it("consume with a well-formed but unknown device_code throws expired_token", async () => {
    const { server } = setup();
    // 43 chars matching base64url — valid format, nonexistent value.
    const fakeCode = "A".repeat(43);
    try {
      await server.consume(fakeCode);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ProtocolError).code).toBe("expired_token");
    }
  });

  it("approve with empty userId throws", async () => {
    const { server } = setup();
    const res = await server.createChallenge();
    await expect(server.approve(res.user_code, ""))
      .rejects.toBeInstanceOf(ProtocolError);
  });
});

describe("DeviceFlowServer: issueSession is called with correct context", () => {
  it("passes the approved userId and challenge to the integrator", async () => {
    const storage = new MemoryStorage();
    const received: Array<{ userId: string; challengeStatus: string }> = [];

    const server = new DeviceFlowServer({
      storage,
      verificationUri: "https://app.example.com/connect",
      issueSession: async ({ userId, challenge }) => {
        received.push({ userId, challengeStatus: challenge.status });
        return { accessToken: "t" };
      },
    });

    const res = await server.createChallenge();
    await server.approve(res.user_code, "alice");
    await server.consume(res.device_code);

    expect(received).toHaveLength(1);
    expect(received[0]?.userId).toBe("alice");
    // Challenge is passed in the approved-consumed state, so integrators
    // can verify the transition was completed before emitting a session.
    expect(received[0]?.challengeStatus).toBe("approved-consumed");
  });
});
