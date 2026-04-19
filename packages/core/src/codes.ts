/**
 * Cryptographically secure code generators for the device flow.
 *
 * SERVER-ONLY: these functions run on the authorization server when a
 * challenge is created. Clients never generate codes — they only receive
 * and display them.
 *
 * Uses the Web Crypto API (`globalThis.crypto`), available in Node 20+
 * and all modern runtimes. No Node-specific imports, so this also works
 * in edge runtimes (Cloudflare Workers, Deno, Bun).
 */

import {
  DEVICE_CODE_BYTES,
  USER_CODE_ALPHABET,
  USER_CODE_LENGTH,
  USER_CODE_PATTERN,
  DEVICE_CODE_PATTERN,
} from "./constants.js";
import { ProtocolError } from "./types.js";

/**
 * Generates an opaque device_code with 256 bits of entropy.
 * Returned as 43 characters of base64url (no padding).
 */
export function generateDeviceCode(): string {
  const bytes = new Uint8Array(DEVICE_CODE_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/**
 * Generates a short user-facing code, rendered as "ABCD-EFGH".
 * Uses rejection sampling to avoid modulo bias.
 */
export function generateUserCode(): string {
  const chars: string[] = [];
  const alphabetLen = USER_CODE_ALPHABET.length;
  // Largest multiple of alphabetLen that fits in a byte, to reject bias.
  const maxUnbiased = Math.floor(256 / alphabetLen) * alphabetLen;

  while (chars.length < USER_CODE_LENGTH) {
    const buf = new Uint8Array(USER_CODE_LENGTH * 2); // oversample
    globalThis.crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte >= maxUnbiased) continue; // reject biased samples
      chars.push(USER_CODE_ALPHABET[byte % alphabetLen]!);
      if (chars.length === USER_CODE_LENGTH) break;
    }
  }

  // Render with a dash for readability: "ABCD-EFGH"
  const mid = USER_CODE_LENGTH / 2;
  return chars.slice(0, mid).join("") + "-" + chars.slice(mid).join("");
}

/**
 * Normalizes a user-submitted code (strips dashes and whitespace, uppercases).
 * Throws if the code does not match the expected pattern.
 */
export function normalizeUserCode(input: string): string {
  const cleaned = input.trim().toUpperCase();
  if (!USER_CODE_PATTERN.test(cleaned)) {
    throw new ProtocolError("invalid_user_code");
  }
  return cleaned.replace("-", "");
}

/**
 * Validates that a device_code matches the expected format.
 * Does not imply the code exists in storage — that's the caller's job.
 */
export function assertValidDeviceCode(input: string): void {
  if (!DEVICE_CODE_PATTERN.test(input)) {
    throw new ProtocolError("invalid_device_code");
  }
}

// ---- internal helpers ----

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
