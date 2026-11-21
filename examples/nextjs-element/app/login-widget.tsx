"use client";

import { createElement, useEffect, useRef } from "react";

/**
 * Renders <qr-device-login> on the client only.
 *
 * The custom element is defined by importing @qr-device-flow/element, and that
 * import touches the browser (HTMLElement). It runs inside an effect, so the
 * server render never evaluates it: the server only emits the tag.
 */
export function LoginWidget() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let detach: (() => void) | undefined;
    let cancelled = false;

    void import("@qr-device-flow/element").then(() => {
      if (cancelled) return;
      const log: Array<{ type: string; detail: unknown }> = [];
      (window as unknown as { qrEvents: typeof log }).qrEvents = log;

      const types = ["qr-state", "qr-approved", "qr-error"] as const;
      const listeners = types.map((type) => {
        const listener = (event: Event) => log.push({ type, detail: (event as CustomEvent).detail });
        element.addEventListener(type, listener);
        return { type, listener };
      });
      detach = () => {
        for (const { type, listener } of listeners) element.removeEventListener(type, listener);
      };
    });

    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);

  // Attributes are plain strings, so this renders the same on server and client.
  return createElement("qr-device-login", { ref, endpoint: "/device", transport: "sse" });
}
