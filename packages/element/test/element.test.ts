import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateQRDataUrl } from "@qr-device-flow/web";
import { QrDeviceLoginElement, defineQrDeviceLogin } from "../src/index.js";

// ── Fake server ────────────────────────────────────────────────────

interface Challenge {
  deviceCode: string;
  userCode: string;
}

interface FakeServer {
  createCalls: number;
  statusCalls: number;
  consumeCalls: number;
  challenges: Challenge[];
}

/**
 * Installs a fake `fetch` for /device/code, /device/status and /device/consume.
 * `statusFor` decides each status reply (default: pending forever).
 */
function installFakeServer(opts: {
  statusFor?: (deviceCode: string, poll: number) => "pending" | "scanned" | "approved" | "denied" | "expired";
  createStatus?: number;
  /** Server runs with verification "none": no number is issued. */
  withoutNumber?: boolean;
} = {}): FakeServer {
  const server: FakeServer = { createCalls: 0, statusCalls: 0, consumeCalls: 0, challenges: [] };
  const polls = new Map<string, number>();

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

    if (url.endsWith("/code") && init?.method === "POST") {
      server.createCalls++;
      if (opts.createStatus) return new Response(null, { status: opts.createStatus });
      const n = server.createCalls;
      const challenge = { deviceCode: `device-${n}`, userCode: `CODE-000${n}` };
      server.challenges.push(challenge);
      return json({
        device_code: challenge.deviceCode,
        user_code: challenge.userCode,
        verification_uri: "https://mobile.example.com/connect",
        verification_uri_complete: `https://mobile.example.com/connect?user_code=${challenge.userCode}`,
        expires_in: 120,
        interval: 5,
        verification_number: opts.withoutNumber ? null : String(10 + n).padStart(2, "0"), // "11", "12", …
      });
    }

    if (url.includes("/status?device_code=")) {
      server.statusCalls++;
      const deviceCode = decodeURIComponent(url.split("device_code=")[1]!);
      const poll = (polls.get(deviceCode) ?? 0) + 1;
      polls.set(deviceCode, poll);
      const status = opts.statusFor?.(deviceCode, poll) ?? "pending";
      return json({ status });
    }

    if (url.endsWith("/consume") && init?.method === "POST") {
      server.consumeCalls++;
      return json({ access_token: "secret-token-xyz", expires_in: 3600 });
    }

    return new Response(null, { status: 404 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return server;
}

// ── Helpers ────────────────────────────────────────────────────────

const flush = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

async function mount(attrs: Record<string, string> = {}): Promise<QrDeviceLoginElement> {
  const el = document.createElement("qr-device-login") as QrDeviceLoginElement;
  const defaults = { endpoint: "/device", transport: "polling" };
  for (const [name, value] of Object.entries({ ...defaults, ...attrs })) {
    el.setAttribute(name, value);
  }
  document.body.appendChild(el);
  await flush();
  return el;
}

const part = (el: HTMLElement, name: string): HTMLElement =>
  el.shadowRoot!.querySelector<HTMLElement>(`[part="${name}"]`)!;

// Every element event bubbles to the document, so one recorder sees them all
// from the moment the element connects (including the first, immediate poll).
const recorded: Array<{ type: string; detail: any }> = [];
for (const type of ["qr-state", "qr-approved", "qr-error"]) {
  document.addEventListener(type, (e) => recorded.push({ type, detail: (e as CustomEvent).detail }));
}

/** Events emitted since the test began. */
function collect(_el?: HTMLElement) {
  return recorded;
}

// ── Tests ──────────────────────────────────────────────────────────

describe("<qr-device-login>", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    recorded.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    document.body.innerHTML = "";
  });

  describe("registration", () => {
    it("registers the tag once and tolerates repeated calls", () => {
      expect(customElements.get("qr-device-login")).toBe(QrDeviceLoginElement);
      expect(() => defineQrDeviceLogin()).not.toThrow();
      expect(customElements.get("qr-device-login")).toBe(QrDeviceLoginElement);
    });
  });

  describe("attributes and properties", () => {
    it("defaults: transport sse, qr size 220, auto-regenerate off", () => {
      const el = document.createElement("qr-device-login") as QrDeviceLoginElement;
      expect(el.transport).toBe("sse");
      expect(el.qrSize).toBe(220);
      expect(el.autoRegenerate).toBe(false);
      expect(el.endpoint).toBe("");
    });

    it("an unknown transport falls back to sse", () => {
      const el = document.createElement("qr-device-login") as QrDeviceLoginElement;
      el.setAttribute("transport", "carrier-pigeon");
      expect(el.transport).toBe("sse");
    });

    it("properties reflect to attributes", () => {
      const el = document.createElement("qr-device-login") as QrDeviceLoginElement;
      el.endpoint = "/api/device";
      el.transport = "polling";
      el.qrSize = 300;
      el.autoRegenerate = true;

      expect(el.getAttribute("endpoint")).toBe("/api/device");
      expect(el.getAttribute("transport")).toBe("polling");
      expect(el.getAttribute("qr-size")).toBe("300");
      expect(el.hasAttribute("auto-regenerate")).toBe(true);

      el.autoRegenerate = false;
      expect(el.hasAttribute("auto-regenerate")).toBe(false);
    });

    it("a non-positive or non-numeric qr-size uses the default", () => {
      const el = document.createElement("qr-device-login") as QrDeviceLoginElement;
      el.setAttribute("qr-size", "abc");
      expect(el.qrSize).toBe(220);
      el.setAttribute("qr-size", "-5");
      expect(el.qrSize).toBe(220);
    });
  });

  describe("login flow", () => {
    it("renders the QR and code for a pending login", async () => {
      installFakeServer();
      const el = await mount();

      expect(part(el, "qr").getAttribute("src")).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(part(el, "qr").hidden).toBe(false);
      expect(part(el, "code").textContent).toBe("CODE-0001");
      expect(part(el, "number").hidden).toBe(false);
      expect(part(el, "number-value").textContent).toBe("11");
      expect(part(el, "status").textContent).toContain("Scan the code");
      expect(el.dataset.state).toBe("pending");
      expect(part(el, "retry").hidden).toBe(true);
    });

    it("hides the verification number once the login is over", async () => {
      installFakeServer({ statusFor: () => "denied" });
      const el = await mount();
      await flush(0);

      expect(el.dataset.state).toBe("denied");
      expect(part(el, "number").hidden).toBe(true);
    });

    it("emits qr-approved with the session, and never renders the token", async () => {
      installFakeServer({ statusFor: () => "approved" });
      const el = await mount();
      const events = collect(el);

      await flush(0);
      await flush(0);

      const approved = events.find((e) => e.type === "qr-approved");
      expect(approved?.detail.session.accessToken).toBe("secret-token-xyz");
      expect(el.dataset.state).toBe("logged-in");
      expect(part(el, "status").textContent).toBe("Logged in.");
      expect(el.shadowRoot!.textContent).not.toContain("secret-token-xyz");
      expect(part(el, "qr").hidden).toBe(true);
    });

    it("emits qr-state for each change, in order", async () => {
      const sequence = ["pending", "scanned", "approved"] as const;
      installFakeServer({ statusFor: (_d, poll) => sequence[Math.min(poll - 1, 2)]! });
      const el = await mount();
      const events = collect(el);

      await flush(5000);
      await flush(5000);
      await flush(0);

      const states = events.filter((e) => e.type === "qr-state").map((e) => e.detail.status);
      expect(states).toEqual(["pending", "scanned", "approved"]);
    });

    it("a denial is a qr-state, not a qr-error, and offers a retry", async () => {
      installFakeServer({ statusFor: () => "denied" });
      const el = await mount();
      const events = collect(el);
      await flush(0);

      expect(el.dataset.state).toBe("denied");
      expect(events.some((e) => e.type === "qr-error")).toBe(false);
      expect(part(el, "retry").hidden).toBe(false);
    });

    it("an expired login hides the QR and offers a retry (no auto-regenerate)", async () => {
      installFakeServer({ statusFor: () => "expired" });
      const el = await mount();
      await flush(0);

      expect(el.dataset.state).toBe("expired");
      expect(part(el, "qr").hidden).toBe(true);
      expect(part(el, "retry").hidden).toBe(false);
    });

    it("the retry button starts a new login with a new code", async () => {
      const server = installFakeServer({ statusFor: (d) => (d === "device-1" ? "denied" : "pending") });
      const el = await mount();
      await flush(0);
      expect(el.dataset.state).toBe("denied");

      part(el, "retry").click();
      await flush(0);

      expect(server.createCalls).toBe(2);
      expect(part(el, "code").textContent).toBe("CODE-0002");
      expect(el.dataset.state).toBe("pending");
    });
  });

  describe("verification off", () => {
    it("hides the number when the server issues none", async () => {
      installFakeServer({ withoutNumber: true });
      const el = await mount();
      expect(part(el, "code").textContent).toBe("CODE-0001");
      expect(part(el, "number").hidden).toBe(true);
    });
  });

  describe("auto-regenerate", () => {
    it("replaces an expired QR with one that encodes the new code, without user action", async () => {
      const server = installFakeServer({
        statusFor: (deviceCode) => (deviceCode === "device-1" ? "expired" : "pending"),
      });
      const el = await mount({ "auto-regenerate": "" });
      await flush(0);

      expect(server.createCalls).toBe(2);
      expect(part(el, "code").textContent).toBe("CODE-0002");
      const expectedQr = await generateQRDataUrl("https://mobile.example.com/connect?user_code=CODE-0002", 220);
      expect(part(el, "qr").getAttribute("src")).toBe(expectedQr);
      expect(part(el, "qr").hidden).toBe(false);
      expect(part(el, "retry").hidden).toBe(true);
      expect(el.dataset.state).toBe("pending");
    });

    it("still emits the expired state before the new QR", async () => {
      installFakeServer({ statusFor: (d) => (d === "device-1" ? "expired" : "pending") });
      const el = await mount({ "auto-regenerate": "" });
      const events = collect(el);
      await flush(0);
      await flush(0);

      expect(events.filter((e) => e.type === "qr-state").map((e) => e.detail.status)).toContain("expired");
    });
  });

  describe("errors", () => {
    it("a missing endpoint is reported as qr-error, with no request sent", async () => {
      const server = installFakeServer();
      const el = document.createElement("qr-device-login");
      el.setAttribute("transport", "polling");
      const events = collect(el);
      document.body.appendChild(el);
      await flush();

      expect(server.createCalls).toBe(0);
      expect(part(el, "error").textContent).toContain("needs an endpoint");
      expect(part(el, "retry").hidden).toBe(false);
      expect(events.some((e) => e.type === "qr-error")).toBe(true);
    });

    it("a failed challenge creation is reported as qr-error", async () => {
      installFakeServer({ createStatus: 500 });
      const el = await mount();
      const events = collect(el);
      await flush(0);

      expect(part(el, "error").textContent).toContain("HTTP 500");
      expect(events.find((e) => e.type === "qr-error")?.detail.message).toContain("HTTP 500");
    });

    it("qr-error bubbles and is composed, so it reaches document listeners", async () => {
      installFakeServer({ createStatus: 503 });
      const seen: string[] = [];
      document.addEventListener("qr-error", (e) => seen.push((e as CustomEvent).detail.message));

      await mount();
      await flush(0);

      expect(seen.length).toBe(1);
      expect(seen[0]).toContain("HTTP 503");
    });
  });

  describe("lifecycle", () => {
    it("changing an attribute restarts the login", async () => {
      const server = installFakeServer();
      const el = await mount();
      expect(server.createCalls).toBe(1);

      el.setAttribute("qr-size", "300");
      await flush(0);

      expect(server.createCalls).toBe(2);
      expect(part(el, "code").textContent).toBe("CODE-0002");
    });

    it("removing the element stops polling", async () => {
      const server = installFakeServer();
      const el = await mount();
      await flush(5000);
      const before = server.statusCalls;

      el.remove();
      await flush(60_000);

      expect(server.statusCalls).toBe(before);
    });

    it("reattaching starts a fresh login", async () => {
      const server = installFakeServer();
      const el = await mount();
      el.remove();
      document.body.appendChild(el);
      await flush(0);

      expect(server.createCalls).toBe(2);
    });
  });

  describe("sse transport", () => {
    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      readonly url: string;
      readonly listeners = new Map<string, (e: MessageEvent) => void>();
      closed = false;
      onerror: (() => void) | null = null;

      constructor(url: string) {
        this.url = url;
        FakeEventSource.instances.push(this);
      }
      addEventListener(type: string, fn: (e: MessageEvent) => void) {
        this.listeners.set(type, fn);
      }
      close() {
        this.closed = true;
      }
      emit(status: string) {
        this.listeners.get("status")?.({ data: JSON.stringify({ status }) } as MessageEvent);
      }
    }

    it("opens an EventSource for the challenge and reacts to pushed statuses", async () => {
      FakeEventSource.instances = [];
      vi.stubGlobal("EventSource", FakeEventSource);
      installFakeServer();

      const el = await mount({ transport: "sse" });
      const events = collect(el);

      expect(FakeEventSource.instances).toHaveLength(1);
      expect(FakeEventSource.instances[0]!.url).toContain("/device/events?device_code=device-1");

      FakeEventSource.instances[0]!.emit("denied");
      await flush(0);

      expect(events.find((e) => e.type === "qr-state")?.detail.status).toBe("denied");
      expect(FakeEventSource.instances[0]!.closed).toBe(true);
    });
  });
});
