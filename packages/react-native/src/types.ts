import type { RequesterInfo } from "@qr-device-flow/core";

/**
 * Configuration for the mobile device flow client.
 */
export interface DeviceFlowMobileConfig {
  /** Base URL of the device flow server (e.g., "https://auth.example.com/device") */
  readonly endpoint: string;
  /** Returns the auth token of the logged-in mobile user, sent as Bearer */
  readonly getAuthToken: () => string | Promise<string>;
}

/**
 * Details about a scanned challenge, shown on the consent screen.
 *
 * The user MUST review `requesterInfo` before approving — this is a
 * non-negotiable security requirement to prevent phishing attacks.
 */
export interface ChallengeDetails {
  readonly userCode: string;
  readonly requesterInfo: RequesterInfo;
  readonly expiresAt: number;
}

/**
 * Props for the QRScanner component.
 */
export interface QRScannerProps {
  /** Called when a QR code is successfully scanned */
  readonly onScan: (userCode: string) => void | Promise<void>;
  /** Optional: custom camera style */
  readonly style?: object;
  /** Optional: whether the scanner is active (default: true) */
  readonly active?: boolean;
}
