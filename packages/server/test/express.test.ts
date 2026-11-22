import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceFlowServer } from "../src/server.js";
import { MemoryStorage } from "../src/storage/memory.js";
import {
  mountDeviceFlowRoutes,
  type DeviceFlowHandler,
  type DeviceFlowRequest,
  type DeviceFlowResponse,
} from "../src/express.js";

// ── Test doubles ───────────────────────────────────────────────────

interface Route {
  method: "GET" | "POST";
  path: string;
  handler: DeviceFlowHandler;
}

function fakeApp() {
  const routes: Route[] = [];
  return {
    routes,
    get: (path: string, handler: DeviceFlowHandler) => {
      routes.push({ method: "GET", path, handler });
    },
    post: (path: string, handler: DeviceFlowHandler) => {
      routes.push({ method: "POST", path, handler });
    },
  };
}

function fakeRes() {
  const state = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    chunks: [] as string[],
    ended: false,
    closeListeners: [] as Array<() => void>,
  };
  const res: DeviceFlowResponse = {
    status(code) {
      state.statusCode = code;
      return res;
    },
    json(body) {
      state.body = body;
      return res;
    },
    setHeader(name, value) {
      state.headers[name] = value;
    },
    write(chunk) {
      state.chunks.push(chunk);
    },
    end() {
      state.ended = true;
    },
    on(_event, listener) {
      state.closeListeners.push(listener);
    },
  };
  return { res, state };
}

function request(partial: Partial<DeviceFlowRequest> = {}): DeviceFlowRequest {
  return { query: {}, headers: {}, ...partial };
}

function setup(opts: { renderQr?: (d: string) => Promise<string> } = {}) {
  const storage = new MemoryStorage();
  const server = new DeviceFlowServer({
    storage,
    verificationUri: "https://mobile.example.com/connect",
    issueSession: async ({ userId }) => ({
      accessToken: `token-${userId}`,
      expiresIn: 3600,
    }),
  });
  const app = fakeApp();
  mountDeviceFlowRoutes(app, {
    server,
    authenticate: (req) => {
      const auth = req.headers.authorization;
      return typeof auth === "string" && auth.startsWith("Bearer ")
        ? auth.slice("Bearer ".length)
        : null;
    },
    ssePollIntervalMs: 1000,
    renderQr: opts.renderQr,
  });

  /**
   * Browser binding cookies, by device code. Like a real browser, the cookie
   * set by POST /code is sent back on the requests for that challenge.
   */
  const cookies = new Map<string, string>();

  /** Calls a mounted route and resolves once its handler has finished. */
  async function call(
    method: "GET" | "POST",
    path: string,
    req: Partial<DeviceFlowRequest> = {},
  ) {
    const route = app.routes.find((r) => r.method === method && r.path === path);
    if (!route) throw new Error(`no route ${method} ${path}`);
    const { res, state } = fakeRes();
    await route.handler(withCookie(req), res);
    if (path.endsWith("/code")) rememberCookie(state);
    return state;
  }

  function rememberCookie(state: { headers: Record<string, string>; body: unknown }) {
    const setCookie = state.headers["Set-Cookie"];
    const deviceCode = (state.body as { device_code?: string } | undefined)?.device_code;
    if (!setCookie || !deviceCode) return;
    cookies.set(deviceCode, setCookie.split(";")[0]!);
  }

  function withCookie(req: Partial<DeviceFlowRequest>): DeviceFlowRequest {
    const deviceCode =
      (req.query?.device_code as string | undefined) ??
      (req.body as { device_code?: string } | undefined)?.device_code;
    const cookie = deviceCode ? cookies.get(deviceCode) : undefined;
    const headers = { ...(req.headers ?? {}) } as Record<string, unknown>;
    if (cookie && headers.cookie === undefined) headers.cookie = cookie;
    return request({ ...req, headers });
  }

  return { server, app, call, cookies, withCookie, rememberCookie };
}

async function createChallenge(call: ReturnType<typeof setup>["call"]) {
  const state = await call("POST", "/device/code", {
    headers: { "user-agent": "TestBrowser/1.0" },
    ip: "203.0.113.7",
  });
  return state.body as {
    device_code: string;
    user_code: string;
    verification_uri_complete: string;
    verification_number: string;
  };
}

// ── Routes ─────────────────────────────────────────────────────────

describe("mountDeviceFlowRoutes: registration", () => {
  it("registers every protocol route under /device by default", () => {
    const { app } = setup();
    const keys = app.routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(keys).toEqual(
      [
        "GET /device/events",
        "GET /device/status",
        "POST /device/approve",
        "POST /device/code",
        "POST /device/consume",
        "POST /device/deny",
        "POST /device/scan",
      ].sort(),
    );
  });

  it("honours basePath, including a trailing slash", () => {
    const storage = new MemoryStorage();
    const server = new DeviceFlowServer({
      storage,
      verificationUri: "https://m.example.com/connect",
      issueSession: async () => ({ accessToken: "t" }),
    });
    const app = fakeApp();
    mountDeviceFlowRoutes(app, {
      server,
      authenticate: () => null,
      basePath: "/api/auth/device/",
    });
    expect(app.routes.map((r) => r.path)).toContain("/api/auth/device/code");
    expect(app.routes.every((r) => !r.path.includes("//"))).toBe(true);
  });
});

describe("mountDeviceFlowRoutes: request/response", () => {
  it("POST /code returns the RFC 8628 fields and no qr_svg by default", async () => {
    const { call } = setup();
    const state = await call("POST", "/device/code");

    expect(state.statusCode).toBe(200);
    expect(state.body).toMatchObject({
      device_code: expect.any(String),
      user_code: expect.stringMatching(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
      verification_uri_complete: expect.stringContaining("user_code="),
      expires_in: expect.any(Number),
      interval: 5,
    });
    expect(state.body).not.toHaveProperty("qr_svg");
  });

  it("POST /code adds qr_svg when renderQr is provided", async () => {
    const { call } = setup({ renderQr: async (d) => `<svg data-d="${d}"/>` });
    const state = await call("POST", "/device/code");
    expect((state.body as { qr_svg: string }).qr_svg).toContain("<svg");
  });

  it("GET /status returns status and rejects a missing device_code", async () => {
    const { call } = setup();
    const challenge = await createChallenge(call);

    const ok = await call("GET", "/device/status", {
      query: { device_code: challenge.device_code },
    });
    expect(ok.body).toEqual({ status: "pending" });

    const missing = await call("GET", "/device/status", { query: {} });
    expect(missing.statusCode).toBe(400);
    expect(missing.body).toMatchObject({ code: "invalid_request" });
  });

  it("scan returns requester_info captured from the browser request", async () => {
    const { call } = setup();
    const challenge = await createChallenge(call);

    const state = await call("POST", "/device/scan", {
      headers: { authorization: "Bearer user-1" },
      body: { user_code: challenge.user_code, verification_number: challenge.verification_number },
    });

    expect(state.statusCode).toBe(200);
    expect(state.body).toMatchObject({
      requester_info: { userAgent: "TestBrowser/1.0", ip: "203.0.113.7" },
      expires_at: expect.any(Number),
    });
  });

  it("scan, approve and deny require an authenticated user", async () => {
    const { call } = setup();
    const challenge = await createChallenge(call);
    const body = { user_code: challenge.user_code, verification_number: challenge.verification_number };

    for (const path of ["/device/scan", "/device/approve", "/device/deny"]) {
      const state = await call("POST", path, { body });
      expect(state.statusCode, path).toBe(401);
      expect(state.body).toMatchObject({ code: "unauthorized" });
    }
  });

  it("approve takes the user from authentication, never from the body", async () => {
    const { call } = setup();
    const challenge = await createChallenge(call);

    const approve = await call("POST", "/device/approve", {
      headers: { authorization: "Bearer real-user" },
      body: {
        user_code: challenge.user_code,
        verification_number: challenge.verification_number,
        user_id: "attacker",
      },
    });
    expect(approve.statusCode).toBe(200);

    const consume = await call("POST", "/device/consume", {
      body: { device_code: challenge.device_code },
    });
    expect(consume.body).toEqual({
      access_token: "token-real-user",
      refresh_token: undefined,
      expires_in: 3600,
    });
  });

  it("consume is single-use", async () => {
    const { call } = setup();
    const challenge = await createChallenge(call);
    await call("POST", "/device/approve", {
      headers: { authorization: "Bearer u" },
      body: { user_code: challenge.user_code, verification_number: challenge.verification_number },
    });

    const first = await call("POST", "/device/consume", {
      body: { device_code: challenge.device_code },
    });
    const second = await call("POST", "/device/consume", {
      body: { device_code: challenge.device_code },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(400);
  });

  it("maps protocol errors to 400 with the protocol code", async () => {
    const { call } = setup();
    const state = await call("POST", "/device/approve", {
      headers: { authorization: "Bearer u" },
      body: { user_code: "ZZZZ-ZZZZ", verification_number: "07" },
    });
    expect(state.statusCode).toBe(400);
    expect(state.body).toMatchObject({ code: "invalid_user_code" });
  });
});

describe("browser binding and number matching", () => {
  async function approveWith(
    call: ReturnType<typeof setup>["call"],
    challenge: { user_code: string },
    verificationNumber: string | undefined,
  ) {
    return call("POST", "/device/approve", {
      headers: { authorization: "Bearer u" },
      body: { user_code: challenge.user_code, verification_number: verificationNumber },
    });
  }

  it("POST /code sets an HttpOnly, SameSite=Strict cookie scoped to the API path, Secure by default", async () => {
    const { call } = setup();
    const state = await call("POST", "/device/code");
    const cookie = state.headers["Set-Cookie"]!;

    expect(cookie).toMatch(/^qrdf_bind=[A-Za-z0-9_-]{43}; /);
    expect(cookie).toContain("Path=/device");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).toMatch(/Max-Age=120/);
  });

  it("the Secure attribute can be turned off for plain-HTTP development", async () => {
    const storage = new MemoryStorage();
    const server = new DeviceFlowServer({
      storage,
      verificationUri: "http://localhost/connect",
      issueSession: async () => ({ accessToken: "t" }),
    });
    const app = fakeApp();
    mountDeviceFlowRoutes(app, { server, authenticate: () => null, secureCookies: false });
    const route = app.routes.find((r) => r.path === "/device/code")!;
    const { res, state } = fakeRes();
    await route.handler(request(), res);
    expect(state.headers["Set-Cookie"]).not.toContain("Secure");
  });

  it("status requires the browser's binding cookie", async () => {
    const { call, app, server } = setup();
    const challenge = await createChallenge(call);

    const withoutCookie = await call("GET", "/device/status", {
      query: { device_code: challenge.device_code },
      headers: { cookie: "unrelated=1" },
    });
    expect(withoutCookie.statusCode).toBe(400);
    expect(withoutCookie.body).toMatchObject({ code: "invalid_binding" });

    const wrongCookie = await call("GET", "/device/status", {
      query: { device_code: challenge.device_code },
      headers: { cookie: "qrdf_bind=not-the-secret" },
    });
    expect(wrongCookie.statusCode).toBe(400);
    expect(wrongCookie.body).toMatchObject({ code: "invalid_binding" });

    // The right cookie (the one the browser got) works.
    const ok = await call("GET", "/device/status", { query: { device_code: challenge.device_code } });
    expect(ok.body).toEqual({ status: "pending" });
    expect(server).toBeDefined();
    expect(app).toBeDefined();
  });

  it("a copied device_code can't be consumed from another browser", async () => {
    const { call } = setup();
    const challenge = await createChallenge(call);
    await approveWith(call, challenge, challenge.verification_number);

    const stolen = await call("POST", "/device/consume", {
      headers: { cookie: "qrdf_bind=attacker-guess" },
      body: { device_code: challenge.device_code },
    });
    expect(stolen.statusCode).toBe(400);
    expect(stolen.body).toMatchObject({ code: "invalid_binding" });

    // The originating browser still gets the session.
    const ok = await call("POST", "/device/consume", { body: { device_code: challenge.device_code } });
    expect(ok.statusCode).toBe(200);
  });

  it("the SSE stream is refused for a foreign browser, before any event is sent", async () => {
    const harness = setup();
    const challenge = await createChallenge(harness.call);
    const route = harness.app.routes.find((r) => r.path === "/device/events")!;
    const { res, state } = fakeRes();
    await route.handler(request({ query: { device_code: challenge.device_code }, headers: {} }), res);

    expect(state.statusCode).toBe(400);
    expect(state.body).toMatchObject({ code: "invalid_binding" });
    expect(state.chunks).toEqual([]);
  });

  it("a wrong verification number is rejected and the challenge stays pending", async () => {
    const { call } = setup();
    const challenge = await createChallenge(call);
    const wrong = challenge.verification_number === "00" ? "01" : "00";

    const state = await approveWith(call, challenge, wrong);
    expect(state.statusCode).toBe(400);
    expect(state.body).toMatchObject({ code: "invalid_verification_number" });

    const status = await call("GET", "/device/status", { query: { device_code: challenge.device_code } });
    expect(status.body).toEqual({ status: "pending" });
  });

  it("three wrong numbers deny the challenge, even if the right number comes next", async () => {
    const { call } = setup();
    const challenge = await createChallenge(call);
    const wrong = challenge.verification_number === "00" ? "01" : "00";

    for (let i = 0; i < 3; i++) {
      await approveWith(call, challenge, wrong);
    }
    const status = await call("GET", "/device/status", { query: { device_code: challenge.device_code } });
    expect(status.body).toEqual({ status: "denied" });

    const late = await approveWith(call, challenge, challenge.verification_number);
    expect(late.statusCode).toBe(400);
    expect(late.body).toMatchObject({ code: "invalid_transition" });
  });

  it("approve requires a two-digit verification number", async () => {
    const { call } = setup();
    const challenge = await createChallenge(call);

    const missing = await approveWith(call, challenge, undefined);
    expect(missing.statusCode).toBe(400);
    expect(missing.body).toMatchObject({ code: "invalid_request" });

    const malformed = await approveWith(call, challenge, "7");
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).toMatchObject({ code: "invalid_verification_number" });
  });
});

// ── SSE ────────────────────────────────────────────────────────────

describe("mountDeviceFlowRoutes: GET /events (SSE)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function openStream(
    harness: ReturnType<typeof setup>,
    deviceCode: string,
  ) {
    const route = harness.app.routes.find((r) => r.path === "/device/events")!;
    const { res, state } = fakeRes();
    void route.handler(harness.withCookie({ query: { device_code: deviceCode } }), res);
    return state;
  }

  it("sends SSE headers, the initial status, and closes on approval", async () => {
    const harness = setup();
    const { call, app } = harness;
    const challenge = await createChallenge(call);
    const stream = openStream(harness, challenge.device_code);
    await vi.advanceTimersByTimeAsync(0);

    expect(stream.headers["Content-Type"]).toBe("text/event-stream");
    expect(stream.chunks).toEqual([
      'event: status\ndata: {"status":"pending"}\n\n',
    ]);

    await call("POST", "/device/approve", {
      headers: { authorization: "Bearer u" },
      body: { user_code: challenge.user_code, verification_number: challenge.verification_number },
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(stream.chunks.at(-1)).toBe('event: status\ndata: {"status":"approved"}\n\n');
    expect(stream.ended).toBe(true);
  });

  it("emits 'expired' and closes when the TTL passes", async () => {
    const harness = setup();
    const { call, app } = harness;
    const challenge = await createChallenge(call);
    const stream = openStream(harness, challenge.device_code);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(121_000);

    expect(stream.chunks.at(-1)).toBe('event: status\ndata: {"status":"expired"}\n\n');
    expect(stream.ended).toBe(true);
  });

  it("stops checking storage when the client disconnects", async () => {
    const harness = setup();
    const { call, app } = harness;
    const challenge = await createChallenge(call);
    const stream = openStream(harness, challenge.device_code);
    await vi.advanceTimersByTimeAsync(0);

    stream.closeListeners.forEach((l) => l());
    const before = stream.chunks.length;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(stream.chunks.length).toBe(before);
    expect(stream.ended).toBe(false);
  });

  it("rejects a malformed device_code before opening the stream", async () => {
    const { app } = setup();
    const { res, state } = fakeRes();
    const route = app.routes.find((r) => r.path === "/device/events")!;
    await route.handler(request({ query: { device_code: "not-a-valid-code" } }), res);

    expect(state.statusCode).toBe(400);
    expect(state.headers["Content-Type"]).toBeUndefined();
    expect(state.chunks).toEqual([]);
  });
});

describe("verification off (server policy none)", () => {
  function setupNone() {
    const storage = new MemoryStorage();
    const server = new DeviceFlowServer({
      storage,
      verificationUri: "https://app.example.com/connect",
      verification: "none",
      issueSession: async ({ userId }) => ({ accessToken: `token-${userId}` }),
    });
    const app = fakeApp();
    mountDeviceFlowRoutes(app, {
      server,
      authenticate: (req) => {
        const auth = req.headers.authorization;
        return typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : null;
      },
    });
    // Like a browser: the binding cookie from /code goes back on later requests.
    let cookie: string | undefined;
    const call = async (method: "GET" | "POST", path: string, req: Partial<DeviceFlowRequest> = {}) => {
      const route = app.routes.find((r) => r.method === method && r.path === path)!;
      const { res, state } = fakeRes();
      await route.handler(request({ ...req, headers: { ...(req.headers ?? {}), ...(cookie ? { cookie } : {}) } }), res);
      if (path === "/device/code" && state.headers["Set-Cookie"]) {
        cookie = state.headers["Set-Cookie"].split(";")[0];
      }
      return state;
    };
    return { call };
  }

  it("/code returns a null verification_number", async () => {
    const { call } = setupNone();
    const state = await call("POST", "/device/code");
    expect((state.body as { verification_number: unknown }).verification_number).toBeNull();
  });

  it("/approve works without verification_number", async () => {
    const { call } = setupNone();
    const challenge = (await call("POST", "/device/code")).body as { device_code: string; user_code: string };

    const approve = await call("POST", "/device/approve", {
      headers: { authorization: "Bearer alice" },
      body: { user_code: challenge.user_code },
    });
    expect(approve.statusCode).toBe(200);

    const consume = await call("POST", "/device/consume", { body: { device_code: challenge.device_code } });
    expect(consume.body).toMatchObject({ access_token: "token-alice" });
  });

  it("/scan tells the phone that no number is needed", async () => {
    const { call } = setupNone();
    const challenge = (await call("POST", "/device/code")).body as { user_code: string };
    const scan = await call("POST", "/device/scan", {
      headers: { authorization: "Bearer alice" },
      body: { user_code: challenge.user_code },
    });
    expect(scan.body).toMatchObject({ verification: "none" });
  });
});

describe("requester origin", () => {
  it("the consent details name the site that asked for the login", async () => {
    const harness = setup();
    const created = await harness.call("POST", "/device/code", {
      headers: { origin: "https://app.example.com" },
    });
    const challenge = created.body as { user_code: string };

    const scan = await harness.call("POST", "/device/scan", {
      headers: { authorization: "Bearer alice" },
      body: { user_code: challenge.user_code },
    });
    expect(scan.body).toMatchObject({
      requester_info: { origin: "https://app.example.com" },
    });
  });

  it("the origin is optional: a request without one has no origin", async () => {
    const harness = setup();
    const challenge = (await harness.call("POST", "/device/code")).body as { user_code: string };
    const scan = await harness.call("POST", "/device/scan", {
      headers: { authorization: "Bearer alice" },
      body: { user_code: challenge.user_code },
    });
    expect((scan.body as { requester_info: { origin?: string } }).requester_info.origin).toBeUndefined();
  });
});
