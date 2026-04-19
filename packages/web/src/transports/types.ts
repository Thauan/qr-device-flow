import type { ChallengeStatus } from "@qr-device-flow/core";

/**
 * Abstraction over the mechanism used to observe real-time status
 * changes for a device-flow challenge.
 *
 * Implementations must call the registered `onStatus` callback
 * whenever the server reports a new {@link ChallengeStatus}, and
 * must stop emitting after {@link disconnect} is called.
 */
export interface Transport {
  /**
   * Start monitoring the challenge identified by `deviceCode`.
   * @param deviceCode  Opaque identifier returned by `POST /device/code`.
   * @param interval    Minimum interval between polls, in seconds (for polling transport).
   */
  connect(deviceCode: string, interval: number): void;

  /**
   * Register a callback that receives every status update from the server.
   * Must be called before {@link connect}.
   */
  onStatus(callback: (status: ChallengeStatus) => void): void;

  /**
   * Register a callback that receives transport-level errors.
   */
  onError?(callback: (error: Error) => void): void;

  /**
   * Stop monitoring and release resources (timers, connections).
   */
  disconnect(): void;
}
