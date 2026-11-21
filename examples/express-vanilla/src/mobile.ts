// Browser stand-in for the mobile app. Bundled to public/mobile-app.js.
//
// It uses the real DeviceFlowMobileClient from @qr-device-flow/react-native
// (the same class a React Native app would use), so the calls, auth header
// and error handling are the SDK's own. What the browser cannot do is scan
// with a camera: the QR is read from the page URL that the QR code encodes.

import {
  DeviceFlowClientError,
  DeviceFlowMobileClient,
  type ChallengeDetails,
} from "@qr-device-flow/react-native/client";

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element: #${id}`);
  return node as T;
};

const userCodeFromUrl = new URLSearchParams(window.location.search).get("user_code");

/** The "signed-in" user of this demo phone. A real app keeps its own session token. */
function signedInUser(): string {
  return el<HTMLInputElement>("user-id").value.trim();
}

const client = new DeviceFlowMobileClient({
  endpoint: "/device",
  getAuthToken: () => {
    const user = signedInUser();
    if (!user) throw new Error("Enter a user ID first.");
    return user;
  },
});

function feedback(message: string, kind: "success" | "error" | "denied"): void {
  const box = el("feedback");
  box.textContent = message;
  box.className = `feedback feedback-${kind}`;
  box.hidden = false;
}

function setBusy(busy: boolean): void {
  for (const id of ["review-btn", "approve-btn", "deny-btn"]) {
    el<HTMLButtonElement>(id).disabled = busy;
  }
}

function showConsent(details: ChallengeDetails): void {
  const info = details.requesterInfo;
  el("requester-agent").textContent = info.userAgent ?? "unknown browser";
  el("requester-ip").textContent = info.ip ?? "unknown";
  el("requester-location").textContent = info.approxLocation ?? "unknown";
  const seconds = Math.max(0, Math.round((details.expiresAt - Date.now()) / 1000));
  el("expires-in").textContent = `${seconds}s`;
  el("consent").hidden = false;
  el("review").hidden = true;
}

function describeError(err: unknown): string {
  if (err instanceof DeviceFlowClientError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

el("user-code").textContent = userCodeFromUrl ?? "—";
if (!userCodeFromUrl) {
  el("no-code").hidden = false;
}

// Step 1: the phone "scanned" the QR. Fetch the request details for the consent screen.
el("review-btn").addEventListener("click", async () => {
  const userCode = userCodeFromUrl;
  if (!userCode) return;
  setBusy(true);
  try {
    showConsent(await client.fetchChallengeDetails(userCode));
  } catch (err) {
    feedback(`Could not load the request: ${describeError(err)}`, "error");
  } finally {
    setBusy(false);
  }
});

// Step 2: the user reviewed the consent screen and approves or denies.
el("approve-btn").addEventListener("click", async () => {
  if (!userCodeFromUrl) return;
  setBusy(true);
  try {
    await client.approve(userCodeFromUrl);
    el("consent").hidden = true;
    feedback("Login approved! You can close this tab.", "success");
  } catch (err) {
    feedback(`Approval failed: ${describeError(err)}`, "error");
    setBusy(false);
  }
});

el("deny-btn").addEventListener("click", async () => {
  if (!userCodeFromUrl) return;
  setBusy(true);
  try {
    await client.deny(userCodeFromUrl);
    el("consent").hidden = true;
    feedback("Login denied. You can close this tab.", "denied");
  } catch (err) {
    feedback(`Denial failed: ${describeError(err)}`, "error");
    setBusy(false);
  }
});
