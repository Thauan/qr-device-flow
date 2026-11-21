// Demo page for <qr-device-login>. Bundled to public/element-app.js.
import "@qr-device-flow/element";
import type { QrDeviceLoginEventMap } from "@qr-device-flow/element";

const element = document.querySelector("qr-device-login")!;
const params = new URLSearchParams(window.location.search);
if (params.get("transport")) element.setAttribute("transport", params.get("transport")!);
if (params.has("auto-regenerate")) element.setAttribute("auto-regenerate", "");

// Every event is logged so tests (and this demo) can see the full sequence.
const log: Array<{ type: string; detail: unknown }> = [];
(window as unknown as { qrEvents: typeof log }).qrEvents = log;
const types: Array<keyof QrDeviceLoginEventMap> = ["qr-state", "qr-approved", "qr-error"];
for (const type of types) {
  element.addEventListener(type, (event) => {
    log.push({ type, detail: (event as CustomEvent).detail });
  });
}
