// React 19 demo for <qr-device-login>. Bundled to public/react-app.js.
//
// The element is created with createElement, and events are attached in an
// effect with addEventListener. That works the same on any React version.
import { createElement, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "@qr-device-flow/element";

const log: Array<{ type: string; detail: unknown }> = [];
(window as unknown as { qrEvents: typeof log }).qrEvents = log;

function Login() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current!;
    const types = ["qr-state", "qr-approved", "qr-error"] as const;
    const listeners = types.map((type) => {
      const listener = (event: Event) => log.push({ type, detail: (event as CustomEvent).detail });
      element.addEventListener(type, listener);
      return { type, listener };
    });
    return () => {
      for (const { type, listener } of listeners) element.removeEventListener(type, listener);
    };
  }, []);

  return createElement("qr-device-login", { ref, endpoint: "/device", transport: "sse" });
}

createRoot(document.getElementById("root")!).render(createElement(Login));
