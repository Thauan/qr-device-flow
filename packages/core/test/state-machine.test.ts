import { describe, it, expect } from "vitest";
import { transition, isTerminal } from "../src/state-machine.js";
import { ProtocolError, type Challenge, type ChallengeStatus } from "../src/types.js";

const T0 = 1_700_000_000_000; // fixed "now" for deterministic tests
const TTL_MS = 120_000;

function makeChallenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    deviceCode: "d".repeat(43),
    userCode: "ABCDEFGH",
    status: "pending",
    createdAt: T0,
    expiresAt: T0 + TTL_MS,
    userId: null,
    requesterInfo: {},
    ...overrides,
  };
}

describe("state machine: valid transitions", () => {
  it("pending → scanned via SCAN", () => {
    const next = transition(makeChallenge(), { type: "SCAN" }, T0);
    expect(next.status).toBe("scanned");
  });

  it("pending → approved via APPROVE", () => {
    const next = transition(makeChallenge(), { type: "APPROVE", userId: "u1" }, T0);
    expect(next.status).toBe("approved");
    expect(next.userId).toBe("u1");
  });

  it("scanned → approved via APPROVE", () => {
    const c = makeChallenge({ status: "scanned" });
    const next = transition(c, { type: "APPROVE", userId: "u1" }, T0);
    expect(next.status).toBe("approved");
    expect(next.userId).toBe("u1");
  });

  it("approved → approved-consumed via CONSUME", () => {
    const c = makeChallenge({ status: "approved", userId: "u1" });
    const next = transition(c, { type: "CONSUME" }, T0);
    expect(next.status).toBe("approved-consumed");
    expect(next.userId).toBe("u1"); // userId is preserved
  });

  it("pending → denied via DENY", () => {
    const next = transition(makeChallenge(), { type: "DENY" }, T0);
    expect(next.status).toBe("denied");
  });

  it("scanned → denied via DENY", () => {
    const c = makeChallenge({ status: "scanned" });
    const next = transition(c, { type: "DENY" }, T0);
    expect(next.status).toBe("denied");
  });

  it("does not mutate the input challenge", () => {
    const c = makeChallenge();
    transition(c, { type: "SCAN" }, T0);
    expect(c.status).toBe("pending"); // unchanged
  });
});

describe("state machine: invalid transitions", () => {
  it("rejects SCAN from scanned (double scan)", () => {
    const c = makeChallenge({ status: "scanned" });
    expect(() => transition(c, { type: "SCAN" }, T0))
      .toThrow(ProtocolError);
  });

  it("rejects SCAN from approved", () => {
    const c = makeChallenge({ status: "approved", userId: "u1" });
    expect(() => transition(c, { type: "SCAN" }, T0))
      .toThrow(ProtocolError);
  });

  it("rejects APPROVE without userId", () => {
    const c = makeChallenge();
    expect(() => transition(c, { type: "APPROVE", userId: "" }, T0))
      .toThrow(ProtocolError);
  });

  it("rejects re-approval with a different user", () => {
    const c = makeChallenge({ status: "approved", userId: "u1" });
    expect(() => transition(c, { type: "APPROVE", userId: "u2" }, T0))
      .toThrow(ProtocolError);
  });

  it("rejects CONSUME from pending (authorization_pending)", () => {
    const c = makeChallenge({ status: "pending" });
    try {
      transition(c, { type: "CONSUME" }, T0);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProtocolError);
      expect((err as ProtocolError).code).toBe("authorization_pending");
    }
  });

  it("rejects CONSUME from scanned (authorization_pending)", () => {
    const c = makeChallenge({ status: "scanned" });
    try {
      transition(c, { type: "CONSUME" }, T0);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ProtocolError).code).toBe("authorization_pending");
    }
  });

  it("rejects CONSUME from denied (authorization_denied)", () => {
    const c = makeChallenge({ status: "denied" });
    try {
      transition(c, { type: "CONSUME" }, T0);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ProtocolError).code).toBe("authorization_denied");
    }
  });

  it("rejects double CONSUME (already_consumed)", () => {
    const c = makeChallenge({ status: "approved-consumed", userId: "u1" });
    try {
      transition(c, { type: "CONSUME" }, T0);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ProtocolError).code).toBe("already_consumed");
    }
  });
});

describe("state machine: terminal states are sticky", () => {
  const terminals: ChallengeStatus[] = ["approved-consumed", "denied", "expired"];

  for (const status of terminals) {
    it(`no event can exit ${status}`, () => {
      const c = makeChallenge({ status, userId: status === "approved-consumed" ? "u1" : null });
      // every possible non-EXPIRE event should fail
      expect(() => transition(c, { type: "SCAN" }, T0)).toThrow();
      expect(() => transition(c, { type: "APPROVE", userId: "u2" }, T0)).toThrow();
      expect(() => transition(c, { type: "DENY" }, T0)).toThrow();
      expect(() => transition(c, { type: "CONSUME" }, T0)).toThrow();
    });

    it(`isTerminal(${status}) is true`, () => {
      expect(isTerminal(status)).toBe(true);
    });
  }

  it("isTerminal returns false for active states", () => {
    expect(isTerminal("pending")).toBe(false);
    expect(isTerminal("scanned")).toBe(false);
    expect(isTerminal("approved")).toBe(false);
  });
});

describe("state machine: expiration", () => {
  it("rejects any non-EXPIRE event past the TTL", () => {
    const c = makeChallenge();
    const tooLate = c.expiresAt + 1;

    expect(() => transition(c, { type: "SCAN" }, tooLate))
      .toThrow(ProtocolError);
    expect(() => transition(c, { type: "APPROVE", userId: "u1" }, tooLate))
      .toThrow(ProtocolError);
  });

  it("expiration error has code expired_token", () => {
    const c = makeChallenge();
    try {
      transition(c, { type: "APPROVE", userId: "u1" }, c.expiresAt + 1);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ProtocolError).code).toBe("expired_token");
    }
  });

  it("EXPIRE event is allowed past TTL (records terminal state)", () => {
    const c = makeChallenge();
    const next = transition(c, { type: "EXPIRE" }, c.expiresAt + 1);
    expect(next.status).toBe("expired");
  });

  it("exactly at expiresAt is considered expired (inclusive boundary)", () => {
    const c = makeChallenge();
    expect(() => transition(c, { type: "SCAN" }, c.expiresAt))
      .toThrow(ProtocolError);
  });

  it("one millisecond before expiresAt still works", () => {
    const c = makeChallenge();
    const next = transition(c, { type: "SCAN" }, c.expiresAt - 1);
    expect(next.status).toBe("scanned");
  });
});

describe("state machine: realistic end-to-end sequences", () => {
  it("happy path: pending → scanned → approved → consumed", () => {
    let s: Challenge = makeChallenge();
    s = transition(s, { type: "SCAN" }, T0 + 1000);
    s = transition(s, { type: "APPROVE", userId: "user-42" }, T0 + 3000);
    s = transition(s, { type: "CONSUME" }, T0 + 3500);
    expect(s.status).toBe("approved-consumed");
    expect(s.userId).toBe("user-42");
  });

  it("fast path: pending → approved → consumed (no SCAN event)", () => {
    // This is the polling transport case — SCAN is not reported.
    let s: Challenge = makeChallenge();
    s = transition(s, { type: "APPROVE", userId: "user-42" }, T0 + 1000);
    s = transition(s, { type: "CONSUME" }, T0 + 1500);
    expect(s.status).toBe("approved-consumed");
  });

  it("denial path: pending → scanned → denied", () => {
    let s: Challenge = makeChallenge();
    s = transition(s, { type: "SCAN" }, T0 + 1000);
    s = transition(s, { type: "DENY" }, T0 + 2000);
    expect(s.status).toBe("denied");
  });
});
