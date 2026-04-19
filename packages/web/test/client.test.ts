import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceCodeResponse } from "@qr-device-flow/core";
import { QRDeviceFlow } from "../src/client.js";
import type { ApprovedSession } from "../src/types.js";

// ── Helpers ────────────────────────────────────────────────────────

const ENDPOINT = "https://api.example.com/device";

function makeDeviceCodeResponse(
  overrides: Partial<DeviceCodeResponse> = {},
): DeviceCodeResponse {
  return {
    device_code: "test-device-code-abc123",
    user_code: "ABCD-EFGH",
    verification_uri: "https://example.com/verify",
    verification_uri_complete:
      "https://example.com/verify?code=ABCD-EFGH",
    expires_in: 120,
    interval: 5,
    ...overrides,
  };
}

function makeConsumeResponse(
  overrides: Partial<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }> = {},
) {
  return {
    access_token: "at_test_token",
    refresh_token: "rt_test_token",
    expires_in: 3600,
    ...overrides,
  };
}

/**
 * Creates a mock `fetch` that responds to:
 * - POST /device/code → DeviceCodeResponse
 * - GET /device/status?device_code=XXX → { status }
 * - POST /device/consume → consume response
 *
 * `statusSequence` is an array of statuses returned by successive
 * status polls. The last value repeats indefinitely.
 */
function mockFetch(
  statusSequence: string[],
  options?: {
    deviceCodeResponse?: DeviceCodeResponse;
    consumeResponse?: ReturnType<typeof makeConsumeResponse>;
    failConsume?: boolean;
    failCreate?: boolean;
  },
) {
  let pollIndex = 0;

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    // POST /device/code — create challenge
    if (url.endsWith("/code") && init?.method === "POST") {
      if (options?.failCreate) {
        return new Response(null, { status: 500 });
      }
      return new Response(
        JSON.stringify(
          options?.deviceCodeResponse ?? makeDeviceCodeResponse(),
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // GET /device/status — poll status
    if (url.includes("/status?device_code=")) {
      const status =
        statusSequence[Math.min(pollIndex, statusSequence.length - 1)]!;
      pollIndex++;
      return new Response(JSON.stringify({ status }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /device/consume
    if (url.endsWith("/consume") && init?.method === "POST") {
      if (options?.failConsume) {
        return new Response(null, { status: 500 });
      }
      return new Response(
        JSON.stringify(options?.consumeResponse ?? makeConsumeResponse()),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(null, { status: 404 });
  });
}

// ── Tests ──────────────────────────────────────────────────────────

describe("QRDeviceFlow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Provide a minimal container in jsdom
    document.body.innerHTML = '<div id="qr-box"></div>';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  // ── 1. Happy path ─────────────────────────────────────────────

  it("happy path: pending → scanned → approved → consume → onApproved", async () => {
    const states: string[] = [];
    let session: ApprovedSession | null = null;

    const fetchMock = mockFetch(["pending", "scanned", "approved"]);
    vi.stubGlobal("fetch", fetchMock);

    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      transport: "polling",
      onStateChange: (s) => states.push(s),
      onApproved: (s) => {
        session = s;
      },
    });

    await flow.start({ container: "#qr-box" });

    // First poll fires immediately (pending)
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toContain("pending");

    // Second poll → scanned
    await vi.advanceTimersByTimeAsync(5000);
    expect(states).toContain("scanned");

    // Third poll → approved, triggers consume
    await vi.advanceTimersByTimeAsync(5000);
    expect(states).toContain("approved");

    // Let consume fetch resolve
    await vi.advanceTimersByTimeAsync(0);

    expect(session).not.toBeNull();
    expect(session!.accessToken).toBe("at_test_token");
    expect(session!.refreshToken).toBe("rt_test_token");
    expect(session!.expiresIn).toBe(3600);

    flow.destroy();
  });

  // ── 2. Headless mode ──────────────────────────────────────────

  it("headless mode returns QR data URL, user code, and device code", async () => {
    const fetchMock = mockFetch(["pending"]);
    vi.stubGlobal("fetch", fetchMock);

    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
    });

    const result = await flow.startHeadless();

    expect(result.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(result.userCode).toBe("ABCD-EFGH");
    expect(result.deviceCode).toBe("test-device-code-abc123");
    expect(result.expiresAt).toBeGreaterThan(Date.now());

    flow.destroy();
  });

  // ── 3. Denial ─────────────────────────────────────────────────

  it("calls onStateChange with 'denied' on denial", async () => {
    const states: string[] = [];
    const errors: Error[] = [];

    const fetchMock = mockFetch(["pending", "denied"]);
    vi.stubGlobal("fetch", fetchMock);

    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      transport: "polling",
      onStateChange: (s) => states.push(s),
      onError: (e) => errors.push(e),
    });

    await flow.start({ container: "#qr-box" });

    // First poll: pending
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toContain("pending");

    // Second poll: denied
    await vi.advanceTimersByTimeAsync(5000);
    expect(states).toContain("denied");
    expect(errors.length).toBe(1);
    expect(errors[0]!.message).toContain("denied");

    flow.destroy();
  });

  // ── 4. Expiration ─────────────────────────────────────────────

  it("calls onStateChange with 'expired' on expiration", async () => {
    const states: string[] = [];

    const fetchMock = mockFetch(["pending", "expired"]);
    vi.stubGlobal("fetch", fetchMock);

    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      transport: "polling",
      onStateChange: (s) => states.push(s),
    });

    await flow.start({ container: "#qr-box" });

    await vi.advanceTimersByTimeAsync(0); // pending
    await vi.advanceTimersByTimeAsync(5000); // expired

    expect(states).toEqual(["pending", "expired"]);

    flow.destroy();
  });

  // ── 5. Auto-regeneration on expiration ────────────────────────

  it("regenerates a new challenge when autoRegenerate is true and status is expired", async () => {
    const states: string[] = [];
    let createCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/code") && init?.method === "POST") {
        createCount++;
        return new Response(
          JSON.stringify(
            makeDeviceCodeResponse({
              device_code: `device-code-${createCount}`,
            }),
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url.includes("/status?device_code=")) {
        // First challenge: always expired; second challenge: pending
        if (url.includes("device-code-1")) {
          return new Response(JSON.stringify({ status: "expired" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ status: "pending" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(null, { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      transport: "polling",
      autoRegenerate: true,
      onStateChange: (s) => states.push(s),
    });

    await flow.start({ container: "#qr-box" });

    // First poll → expired → triggers regeneration
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toContain("expired");

    // Let the regeneration (createChallenge + new poll) settle
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    // Should have created 2 challenges
    expect(createCount).toBe(2);

    flow.destroy();
  });

  // ── 6. Destroy stops polling ──────────────────────────────────

  it("destroy stops polling and clears DOM", async () => {
    const states: string[] = [];

    const fetchMock = mockFetch(["pending", "pending", "pending"]);
    vi.stubGlobal("fetch", fetchMock);

    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      transport: "polling",
      onStateChange: (s) => states.push(s),
    });

    await flow.start({ container: "#qr-box" });
    await vi.advanceTimersByTimeAsync(0); // first poll → pending

    const container = document.querySelector("#qr-box") as HTMLElement;
    expect(container.innerHTML).not.toBe("");

    // Destroy the flow
    flow.destroy();

    // Container should be cleared
    expect(container.innerHTML).toBe("");

    // Advance time — no more polls should fire
    const callsBefore = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  // ── 7. Transport selection ────────────────────────────────────

  it("defaults to polling transport", async () => {
    const fetchMock = mockFetch(["pending"]);
    vi.stubGlobal("fetch", fetchMock);

    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
    });

    // Start headless so we don't need DOM setup for this test
    await flow.startHeadless();
    await vi.advanceTimersByTimeAsync(0);

    // The status poll should have been called via fetch (polling transport)
    const statusCalls = fetchMock.mock.calls.filter((call) => {
      const url = typeof call[0] === "string" ? call[0] : call[0]?.toString();
      return url?.includes("/status?device_code=");
    });
    expect(statusCalls.length).toBeGreaterThan(0);

    flow.destroy();
  });

  it("can be configured with SSE transport type", () => {
    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      transport: "sse",
    });

    // Just verifying it constructs without error
    expect(flow).toBeDefined();
    flow.destroy();
  });

  it("can be configured with WebSocket transport type", () => {
    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      transport: "websocket",
    });

    expect(flow).toBeDefined();
    flow.destroy();
  });

  // ── 8. Error handling ─────────────────────────────────────────

  it("calls onError when challenge creation fails", async () => {
    const errors: Error[] = [];
    const fetchMock = mockFetch([], { failCreate: true });
    vi.stubGlobal("fetch", fetchMock);

    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      onError: (e) => errors.push(e),
    });

    await expect(flow.startHeadless()).rejects.toThrow("HTTP 500");

    flow.destroy();
  });

  it("calls onError when consume fails", async () => {
    const errors: Error[] = [];

    const fetchMock = mockFetch(["approved"], { failConsume: true });
    vi.stubGlobal("fetch", fetchMock);

    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      transport: "polling",
      onError: (e) => errors.push(e),
    });

    await flow.startHeadless();

    // Poll fires → approved → consume fails
    await vi.advanceTimersByTimeAsync(0);
    // Let consume settle
    await vi.advanceTimersByTimeAsync(0);

    expect(errors.length).toBe(1);
    expect(errors[0]!.message).toContain("consume");

    flow.destroy();
  });

  it("calls onError on network failure during polling", async () => {
    const errors: Error[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/code") && init?.method === "POST") {
        return new Response(JSON.stringify(makeDeviceCodeResponse()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/status?device_code=")) {
        throw new TypeError("Failed to fetch");
      }

      return new Response(null, { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      transport: "polling",
      onError: (e) => errors.push(e),
    });

    await flow.startHeadless();
    await vi.advanceTimersByTimeAsync(0); // first poll → network error

    expect(errors.length).toBe(1);
    expect(errors[0]!.message).toContain("Failed to fetch");

    flow.destroy();
  });

  // ── 9. QR renders into container ──────────────────────────────

  it("renders QR SVG into the specified container", async () => {
    const fetchMock = mockFetch(["pending"]);
    vi.stubGlobal("fetch", fetchMock);

    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
    });

    await flow.start({ container: "#qr-box" });

    const container = document.querySelector("#qr-box") as HTMLElement;
    expect(container.innerHTML).toContain("<svg");
    expect(container.innerHTML).toContain("</svg>");

    flow.destroy();
  });

  it("throws when container selector does not match any element", async () => {
    const fetchMock = mockFetch(["pending"]);
    vi.stubGlobal("fetch", fetchMock);

    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
    });

    await expect(
      flow.start({ container: "#nonexistent" }),
    ).rejects.toThrow("Container element not found");

    flow.destroy();
  });

  // ── 10. Polling respects minimum interval ─────────────────────

  it("clamps poll interval to the RFC minimum of 5 seconds", async () => {
    const states: string[] = [];

    const fetchMock = mockFetch(["pending", "pending", "scanned"]);
    vi.stubGlobal("fetch", fetchMock);

    const deviceCodeResponse = makeDeviceCodeResponse({ interval: 1 }); // below minimum
    const customFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/code") && init?.method === "POST") {
        return new Response(JSON.stringify(deviceCodeResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return fetchMock(input, init);
    });

    vi.stubGlobal("fetch", customFetch);

    const flow = new QRDeviceFlow({
      endpoint: ENDPOINT,
      transport: "polling",
      onStateChange: (s) => states.push(s),
    });

    await flow.startHeadless();
    await vi.advanceTimersByTimeAsync(0); // first immediate poll

    // At 3 seconds (below 5s min), no second poll yet
    await vi.advanceTimersByTimeAsync(3000);
    const statusCallsAt3s = customFetch.mock.calls.filter((call) => {
      const url = typeof call[0] === "string" ? call[0] : call[0]?.toString();
      return url?.includes("/status?device_code=");
    });
    expect(statusCallsAt3s.length).toBe(1); // only the initial poll

    // At 5 seconds, second poll fires
    await vi.advanceTimersByTimeAsync(2000);
    const statusCallsAt5s = customFetch.mock.calls.filter((call) => {
      const url = typeof call[0] === "string" ? call[0] : call[0]?.toString();
      return url?.includes("/status?device_code=");
    });
    expect(statusCallsAt5s.length).toBe(2);

    flow.destroy();
  });
});
