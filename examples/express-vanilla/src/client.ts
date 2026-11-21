// Browser entry for the login page. Bundled to public/app.js by `pnpm run build:client`.
//
// Uses the real @qr-device-flow/web client, so the demo (and the e2e tests)
// exercise the published library, not a hand-written copy of it.
//
// Pick the transport with ?transport=sse (default) or ?transport=polling.

import { QRDeviceFlow, type ApprovedSession, type TransportType } from "@qr-device-flow/web";

const TRANSPORTS: readonly TransportType[] = ["sse", "polling"];

function pickTransport(): TransportType {
  const requested = new URLSearchParams(window.location.search).get("transport");
  return TRANSPORTS.includes(requested as TransportType)
    ? (requested as TransportType)
    : "sse";
}

const MESSAGES: Record<string, string> = {
  pending: "Waiting for scan…",
  scanned: "Phone detected! Confirm on your device…",
  approved: "Approved on your phone, logging in…",
  denied: "Login denied on your phone.",
  expired: "Session expired. Please try again.",
  "approved-consumed": "This session was already used.",
};

const el = <T extends HTMLElement = HTMLElement>(testId: string): T => {
  const node = document.querySelector<T>(`[data-testid="${testId}"]`);
  if (!node) throw new Error(`missing element: ${testId}`);
  return node;
};

function setStatus(state: string, text?: string): void {
  const status = el("status");
  status.dataset.state = state;
  status.textContent = text ?? MESSAGES[state] ?? state;
}

function showError(message: string): void {
  const box = el("error");
  box.textContent = message;
  box.hidden = false;
}

function clearError(): void {
  el("error").hidden = true;
}

function showSession(session: ApprovedSession): void {
  setStatus("logged-in", "Logged in successfully!");
  el("qr").hidden = true;
  el("user-code").hidden = true;
  el("retry").hidden = true;
  const box = el("session");
  box.textContent = JSON.stringify(session, null, 2);
  box.hidden = false;
}

let flow: QRDeviceFlow | null = null;

async function start(): Promise<void> {
  flow?.destroy();
  clearError();
  el("session").hidden = true;
  el("retry").hidden = true;
  el("qr").hidden = false;
  el("user-code").hidden = false;
  setStatus("loading", "Creating login request…");

  const transport = pickTransport();
  el("transport").textContent = transport;

  const current = new QRDeviceFlow({
    endpoint: "/device",
    transport,
    onStateChange: (state) => {
      if (state === "expired" || state === "denied" || state === "approved-consumed") {
        el("retry").hidden = false;
      }
      if (state !== "approved") setStatus(state);
    },
    onApproved: (session) => showSession(session),
    onError: (err) => {
      // A denial is already shown as a status; everything else is an error.
      if (err.message !== "Authorization denied by user") showError(err.message);
    },
  });
  flow = current;

  try {
    const { qrDataUrl, userCode } = await current.startHeadless();
    if (flow !== current) return; // a newer start() replaced this one

    el<HTMLImageElement>("qr").src = qrDataUrl;
    el("user-code").textContent = userCode;
    setStatus("pending");
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    el("retry").hidden = false;
  }
}

el("retry").addEventListener("click", () => {
  void start();
});

void start();
