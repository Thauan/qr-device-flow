import { describe, it, expect } from "vitest";
import {
  generateDeviceCode,
  generateUserCode,
  normalizeUserCode,
  assertValidDeviceCode,
} from "../src/codes.js";
import {
  DEVICE_CODE_PATTERN,
  USER_CODE_PATTERN,
  USER_CODE_ALPHABET,
} from "../src/constants.js";
import { ProtocolError } from "../src/types.js";

describe("generateDeviceCode", () => {
  it("produces a string of the expected length (43 base64url chars from 32 bytes)", () => {
    const code = generateDeviceCode();
    expect(code).toHaveLength(43);
  });

  it("matches the expected base64url pattern", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateDeviceCode()).toMatch(DEVICE_CODE_PATTERN);
    }
  });

  it("never contains base64 padding or non-url-safe chars", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateDeviceCode();
      expect(code).not.toMatch(/[=+/]/);
    }
  });

  it("produces unique codes (high entropy)", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 10_000; i++) codes.add(generateDeviceCode());
    expect(codes.size).toBe(10_000); // no collisions at this scale
  });
});

describe("generateUserCode", () => {
  it("has the shape XXXX-XXXX", () => {
    const code = generateUserCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("matches the expected pattern", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateUserCode()).toMatch(USER_CODE_PATTERN);
    }
  });

  it("never contains visually ambiguous characters (0, O, 1, I, L)", () => {
    const forbidden = /[01OILoil]/;
    for (let i = 0; i < 1000; i++) {
      const code = generateUserCode();
      expect(code).not.toMatch(forbidden);
    }
  });

  it("only uses characters from USER_CODE_ALPHABET", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateUserCode().replace("-", "");
      for (const ch of code) {
        expect(USER_CODE_ALPHABET).toContain(ch);
      }
    }
  });

  it("has reasonable distribution across the alphabet (no obvious bias)", () => {
    // Sanity check for our rejection sampling: with 10k codes of 8 chars,
    // every char in the 31-char alphabet should appear many times.
    const counts = new Map<string, number>();
    for (let i = 0; i < 10_000; i++) {
      const code = generateUserCode().replace("-", "");
      for (const ch of code) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    // Each char should show up roughly 10000*8/31 ≈ 2580 times.
    // Allow a wide tolerance — this is a smoke test, not a statistical proof.
    for (const ch of USER_CODE_ALPHABET) {
      const count = counts.get(ch) ?? 0;
      expect(count).toBeGreaterThan(1000);
      expect(count).toBeLessThan(5000);
    }
  });

  it("produces unique codes across many generations", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 10_000; i++) codes.add(generateUserCode());
    // With ~35 bits of entropy, 10k codes should essentially never collide.
    expect(codes.size).toBe(10_000);
  });
});

describe("normalizeUserCode", () => {
  it("strips the dash", () => {
    expect(normalizeUserCode("ABCD-EFGH")).toBe("ABCDEFGH");
  });

  it("accepts codes without a dash", () => {
    expect(normalizeUserCode("ABCDEFGH")).toBe("ABCDEFGH");
  });

  it("uppercases lowercase input", () => {
    expect(normalizeUserCode("abcd-efgh")).toBe("ABCDEFGH");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeUserCode("  ABCD-EFGH  ")).toBe("ABCDEFGH");
  });

  it("rejects codes containing forbidden characters", () => {
    expect(() => normalizeUserCode("0000-0000")).toThrow(ProtocolError);
    expect(() => normalizeUserCode("IIII-LLLL")).toThrow(ProtocolError);
  });

  it("rejects codes of wrong length", () => {
    expect(() => normalizeUserCode("ABCD-EFG")).toThrow(ProtocolError);
    expect(() => normalizeUserCode("ABCDE-FGHI")).toThrow(ProtocolError);
  });

  it("rejects empty input", () => {
    expect(() => normalizeUserCode("")).toThrow(ProtocolError);
  });

  it("rejects SQL-injection-looking input gracefully", () => {
    expect(() => normalizeUserCode("'; DROP TABLE--")).toThrow(ProtocolError);
  });

  it("round-trips a freshly-generated code", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateUserCode();
      const normalized = normalizeUserCode(code);
      expect(normalized).toHaveLength(8);
      expect(USER_CODE_PATTERN.test(code)).toBe(true);
    }
  });
});

describe("assertValidDeviceCode", () => {
  it("accepts freshly-generated device codes", () => {
    for (let i = 0; i < 50; i++) {
      expect(() => assertValidDeviceCode(generateDeviceCode())).not.toThrow();
    }
  });

  it("rejects the empty string", () => {
    expect(() => assertValidDeviceCode("")).toThrow(ProtocolError);
  });

  it("rejects short strings", () => {
    expect(() => assertValidDeviceCode("abc")).toThrow(ProtocolError);
  });

  it("rejects strings with forbidden characters", () => {
    expect(() => assertValidDeviceCode("a".repeat(42) + "="))
      .toThrow(ProtocolError);
    expect(() => assertValidDeviceCode("a".repeat(42) + "+"))
      .toThrow(ProtocolError);
  });

  it("error has code invalid_device_code", () => {
    try {
      assertValidDeviceCode("nope");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ProtocolError).code).toBe("invalid_device_code");
    }
  });
});
