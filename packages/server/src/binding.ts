/**
 * Browser binding helpers.
 *
 * When the browser asks for a challenge, the HTTP layer generates a random
 * secret, sends it back as an HttpOnly cookie, and stores only its hash on the
 * challenge. Later requests (status, events, consume) must present the cookie.
 * A device_code copied out of the browser is then not enough to claim a session.
 *
 * Node-only (uses node:crypto). The server package already requires Node.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Name of the cookie that carries the binding secret. */
export const BINDING_COOKIE = "qrdf_bind";

/** A fresh 256-bit binding secret, base64url. */
export function createBindingSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Hex SHA-256 of a binding secret. This is what the challenge stores. */
export function hashBindingSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * Compares two strings in constant time. Different lengths return false
 * without a timing leak about the contents.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
