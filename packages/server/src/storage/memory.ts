/**
 * In-memory storage. For tests, local dev, and single-process demos only.
 * Do NOT use in production — state is lost on restart and not shared
 * across processes.
 *
 * Atomicity here is trivially satisfied because JavaScript is
 * single-threaded per event loop tick. Real implementations need to
 * translate compareAndSwap to their backend's atomic primitives.
 */

import type { Challenge } from "@qr-device-flow/core";
import type { ChallengeStorage } from "../storage.js";

export class MemoryStorage implements ChallengeStorage {
  private readonly byDeviceCode = new Map<string, Challenge>();
  private readonly userCodeIndex = new Map<string, string>();

  async create(challenge: Challenge): Promise<void> {
    if (this.byDeviceCode.has(challenge.deviceCode)) {
      throw new Error(`deviceCode already exists: ${challenge.deviceCode}`);
    }
    this.byDeviceCode.set(challenge.deviceCode, challenge);
    this.userCodeIndex.set(challenge.userCode, challenge.deviceCode);
  }

  async getByDeviceCode(deviceCode: string): Promise<Challenge | null> {
    return this.byDeviceCode.get(deviceCode) ?? null;
  }

  async getByUserCode(userCode: string): Promise<Challenge | null> {
    const deviceCode = this.userCodeIndex.get(userCode);
    if (!deviceCode) return null;
    return this.byDeviceCode.get(deviceCode) ?? null;
  }

  async compareAndSwap(
    deviceCode: string,
    expected: Challenge,
    next: Challenge,
  ): Promise<{ ok: true } | { ok: false; current: Challenge | null }> {
    const current = this.byDeviceCode.get(deviceCode) ?? null;
    // Deep-ish equality: the fields that can change mid-flight are
    // `status` and `userId`. If either differs, the caller lost the race.
    if (
      current === null ||
      current.status !== expected.status ||
      current.userId !== expected.userId
    ) {
      return { ok: false, current };
    }
    this.byDeviceCode.set(deviceCode, next);
    return { ok: true };
  }

  async purgeExpired(now: number): Promise<number> {
    let removed = 0;
    for (const [deviceCode, challenge] of this.byDeviceCode) {
      if (challenge.expiresAt <= now) {
        this.byDeviceCode.delete(deviceCode);
        this.userCodeIndex.delete(challenge.userCode);
        removed++;
      }
    }
    return removed;
  }

  // Test helpers (not part of the public interface):
  _size(): number {
    return this.byDeviceCode.size;
  }
}
