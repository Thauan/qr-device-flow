/**
 * @qr-device-flow/element — `<qr-device-login>` custom element.
 *
 * Importing this module registers the element (in browsers only).
 *
 * @example
 * ```html
 * <script type="module" src="/node_modules/@qr-device-flow/element/dist/index.js"></script>
 * <qr-device-login endpoint="/device" transport="sse"></qr-device-login>
 * <script>
 *   document.querySelector("qr-device-login")
 *     .addEventListener("qr-approved", (e) => console.log(e.detail.session));
 * </script>
 * ```
 *
 * @packageDocumentation
 */

export { QrDeviceLoginElement, defineQrDeviceLogin } from "./qr-device-login.js";
export type {
  QrStateDetail,
  QrApprovedDetail,
  QrErrorDetail,
  QrDeviceLoginEventMap,
} from "./qr-device-login.js";
