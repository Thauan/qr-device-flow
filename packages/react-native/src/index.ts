/**
 * @qr-device-flow/react-native
 *
 * React Native client for QR-based device authentication (RFC 8628).
 *
 * Provides:
 * - `DeviceFlowMobileClient` — HTTP client for scan/approve/deny
 * - `useDeviceFlowClient` — React hook returning a memoized client
 * - `QRScanner` — Camera component for scanning QR codes
 * - Types for configuration and challenge details
 */

export { DeviceFlowMobileClient, DeviceFlowClientError } from "./client.js";
export { useDeviceFlowClient } from "./use-device-flow.js";
export { QRScanner } from "./QRScanner.js";
export type {
  DeviceFlowMobileConfig,
  ChallengeDetails,
  QRScannerProps,
} from "./types.js";
