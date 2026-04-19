import { useMemo } from "react";
import { DeviceFlowMobileClient } from "./client.js";
import type { DeviceFlowMobileConfig } from "./types.js";

/**
 * React hook that returns a memoized DeviceFlowMobileClient instance.
 *
 * The client is recreated only when `config.endpoint` changes.
 *
 * Usage:
 * ```tsx
 * const client = useDeviceFlowClient({
 *   endpoint: "https://auth.example.com/device",
 *   getAuthToken: () => authStore.getToken(),
 * });
 *
 * // On QR scan:
 * const details = await client.fetchChallengeDetails(userCode);
 * // Show consent screen with details.requesterInfo
 * // Then:
 * await client.approve(userCode);
 * ```
 */
export function useDeviceFlowClient(
  config: DeviceFlowMobileConfig,
): DeviceFlowMobileClient {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on endpoint only
  return useMemo(() => new DeviceFlowMobileClient(config), [config.endpoint]);
}
