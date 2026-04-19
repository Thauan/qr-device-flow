/**
 * @qr-device-flow/web — Browser client for QR-based device authentication.
 *
 * @example
 * ```ts
 * import { QRDeviceFlow } from "@qr-device-flow/web";
 *
 * const flow = new QRDeviceFlow({
 *   endpoint: "https://api.example.com/device",
 *   transport: "polling",
 *   onApproved: (session) => console.log("Logged in!", session),
 *   onError: (err) => console.error(err),
 * });
 *
 * // DOM mode
 * flow.start({ container: "#qr-box" });
 *
 * // Headless mode
 * const { qrDataUrl } = await flow.startHeadless();
 * ```
 *
 * @packageDocumentation
 */

export { QRDeviceFlow } from "./client.js";
export { generateQRSvg, generateQRDataUrl } from "./qr.js";

export type {
  QRDeviceFlowOptions,
  ApprovedSession,
  HeadlessResult,
  TransportType,
} from "./types.js";

export type { Transport } from "./transports/types.js";
