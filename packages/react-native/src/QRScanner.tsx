import React, { useCallback, useRef } from "react";
import type { QRScannerProps } from "./types.js";

// Minimum interval between scans in milliseconds to prevent duplicate firings
const DEBOUNCE_MS = 2_000;

/**
 * QR code scanner component for the device flow.
 *
 * Wraps `expo-camera`'s CameraView with barcode scanning configured for QR codes.
 * Debounces scan events to prevent firing multiple times for the same QR code.
 *
 * Requires `expo-camera` as a peer dependency.
 *
 * Usage:
 * ```tsx
 * <QRScanner
 *   onScan={(userCode) => handleScan(userCode)}
 *   active={isScanning}
 * />
 * ```
 */
export function QRScanner({
  onScan,
  style,
  active = true,
}: QRScannerProps): React.ReactElement | null {
  const lastScannedRef = useRef<string | null>(null);
  const lastScannedTimeRef = useRef<number>(0);

  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (!active) return;

      const now = Date.now();
      // Debounce: ignore if same code scanned within the debounce window
      if (
        data === lastScannedRef.current &&
        now - lastScannedTimeRef.current < DEBOUNCE_MS
      ) {
        return;
      }

      lastScannedRef.current = data;
      lastScannedTimeRef.current = now;
      void onScan(data);
    },
    [active, onScan],
  );

  if (!active) return null;

  // Lazy-require expo-camera so the module only fails at runtime
  // if the peer dependency is not installed, rather than at import time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CameraView } = require("expo-camera") as {
    CameraView: React.ComponentType<{
      style?: object;
      barcodeScannerSettings?: { barcodeTypes: string[] };
      onBarcodeScanned?: (event: { data: string }) => void;
    }>;
  };

  return (
    <CameraView
      style={style ?? { flex: 1 }}
      barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
      onBarcodeScanned={handleBarcodeScanned}
    />
  );
}
