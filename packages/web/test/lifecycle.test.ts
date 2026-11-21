import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QRDeviceFlow } from "../src/client.js";

// Regression tests for the challenge lifecycle: approval must consume once,
// expiry must be reported even when the server stops saying so, and polling
// must stop once the challenge is over.

const ENDPOINT = "https://api.example.com/device";

const CHALLENGE = {
  device_code: "device-code-lifecycle",
  user_code: "ABCD-EFGH",
  verification_uri: "https://example.com/verify",
  verification_uri_complete: "https://example.com/verify?user_code=ABCD-EFGH",
  expires_in: 120,
  interval: 5,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Fake server. `statusFor` decides the response to the Nth status poll.
 */
function fakeServer(statusFor: (poll: number) => Response) {
  let statusCalls = 0;
  let consumeCalls = 0;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.endsWith("/code") && init?.method === "POST") {
      return json(CHALLENGE);
    }
    if (url.includes("/status?device_code=")) {
      statusCalls++;
      return statusFor(statusCalls);
    }
    if (url.endsWith("/consume") && init?.method === "POST") {
      consumeCalls++;
      return json({ access_token: "at_lifecycle", expires_in: 3600 });
    }
    return new Response(null, { status: 404 });
  });

  return {
    fetchMock,
    statusCalls: () => statusCalls,
    consumeCalls: () => consumeCalls,
  };
}

describe("QRDeviceFlow lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("consumes exactly once when the server keeps reporting 'approved'", async () => {
    const server = fakeServer(() => json({ status: "approved" }));
    vi.stubGlobal("fetch", server.fetchMock);

    const approved: string[] = [];
    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      onApproved: (s) => approved.push(s.accessToken),
    });

    await flow.startHeadless();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    // Keep time moving: no further polls or consumes should happen.
    await vi.advanceTimersByTimeAsync(30_000);

    expect(server.statusCalls()).toBe(1);
    expect(server.consumeCalls()).toBe(1);
    expect(approved).toEqual(["at_lifecycle"]);

    flow.destroy();
  });

  it("treats 400 expired_token from the status endpoint as 'expired', not an error", async () => {
    const server = fakeServer(() =>
      json({ error: "expired_token", code: "expired_token" }, 400),
    );
    vi.stubGlobal("fetch", server.fetchMock);

    const states: string[] = [];
    const errors: Error[] = [];
    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      onStateChange: (s) => states.push(s),
      onError: (e) => errors.push(e),
    });

    await flow.startHeadless();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(states).toEqual(["expired"]);
    expect(errors).toEqual([]);

    // Polling stops after expiry.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.statusCalls()).toBe(1);

    flow.destroy();
  });

  it("expires locally at expires_in even if the server keeps saying 'pending'", async () => {
    const server = fakeServer(() => json({ status: "pending" }));
    vi.stubGlobal("fetch", server.fetchMock);

    const states: string[] = [];
    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      onStateChange: (s) => states.push(s),
    });

    await flow.startHeadless();

    await vi.advanceTimersByTimeAsync(119_000);
    expect(states).not.toContain("expired");

    await vi.advanceTimersByTimeAsync(2_000);
    expect(states[states.length - 1]).toBe("expired");

    const pollsAtExpiry = server.statusCalls();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.statusCalls()).toBe(pollsAtExpiry);

    flow.destroy();
  });

  it("stops polling after denial and reports it once", async () => {
    const server = fakeServer(() => json({ status: "denied" }));
    vi.stubGlobal("fetch", server.fetchMock);

    const errors: Error[] = [];
    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      onError: (e) => errors.push(e),
    });

    await flow.startHeadless();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(errors.map((e) => e.message)).toEqual([
      "Authorization denied by user",
    ]);
    expect(server.statusCalls()).toBe(1);

    flow.destroy();
  });

  it("headless autoRegenerate hands the caller a new QR and code (onRegenerate)", async () => {
    let created = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/code") && init?.method === "POST") {
        created++;
        return json({
          ...CHALLENGE,
          device_code: `device-${created}`,
          user_code: `CODE-000${created}`,
          verification_uri_complete: `https://example.com/verify?user_code=CODE-000${created}`,
        });
      }
      if (url.includes("device_code=device-1")) return json({ status: "expired" });
      if (url.includes("device_code=device-2")) return json({ status: "pending" });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const regenerated: Array<{ deviceCode: string; userCode: string; qrDataUrl: string }> = [];
    const states: string[] = [];
    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      transport: "polling",
      autoRegenerate: true,
      onStateChange: (s) => states.push(s),
      onRegenerate: (r) => regenerated.push({ deviceCode: r.deviceCode, userCode: r.userCode, qrDataUrl: r.qrDataUrl }),
    });

    const first = await flow.startHeadless();
    await vi.advanceTimersByTimeAsync(0); // device-1 → expired → regenerate
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(states).toContain("expired");
    expect(regenerated).toHaveLength(1);
    expect(regenerated[0]!.deviceCode).toBe("device-2");
    expect(regenerated[0]!.userCode).toBe("CODE-0002");
    expect(regenerated[0]!.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(regenerated[0]!.qrDataUrl).not.toBe(first.qrDataUrl);

    // The new challenge is monitored: its status is polled, not the old one.
    await vi.advanceTimersByTimeAsync(5000);
    const polled = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/status"));
    expect(polled.at(-1)).toContain("device-2");

    flow.destroy();
  });
});
