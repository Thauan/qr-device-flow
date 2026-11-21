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

  /** Calls a mounted route and resolves once its handler has finished. */
  async function call(
    method: "GET" | "POST",
    path: string,
    req: Partial<DeviceFlowRequest> = {},
  ) {
    const route = app.routes.find((r) => r.method === method && r.path === path);
    if (!route) throw new Error(`no route ${method} ${path}`);
    const { res, state } = fakeRes();
    await route.handler(request(req), res);
    return state;
  }

  return { server, app, call };
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
      body: { user_code: challenge.user_code },
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
    const body = { user_code: challenge.user_code };

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
      body: { user_code: challenge.user_code, user_id: "attacker" },
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
      body: { user_code: challenge.user_code },
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
      body: { user_code: "ZZZZ-ZZZZ" },
    });
    expect(state.statusCode).toBe(400);
    expect(state.body).toMatchObject({ code: "invalid_user_code" });
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
    call: ReturnType<typeof setup>["call"],
    app: ReturnType<typeof setup>["app"],
    deviceCode: string,
  ) {
    const route = app.routes.find((r) => r.path === "/device/events")!;
    const { res, state } = fakeRes();
    void route.handler(request({ query: { device_code: deviceCode } }), res);
    return state;
  }

  it("sends SSE headers, the initial status, and closes on approval", async () => {
    const { call, app } = setup();
    const challenge = await createChallenge(call);
    const stream = openStream(call, app, challenge.device_code);
    await vi.advanceTimersByTimeAsync(0);

    expect(stream.headers["Content-Type"]).toBe("text/event-stream");
    expect(stream.chunks).toEqual([
      'event: status\ndata: {"status":"pending"}\n\n',
    ]);

    await call("POST", "/device/approve", {
      headers: { authorization: "Bearer u" },
      body: { user_code: challenge.user_code },
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(stream.chunks.at(-1)).toBe('event: status\ndata: {"status":"approved"}\n\n');
    expect(stream.ended).toBe(true);
  });

  it("emits 'expired' and closes when the TTL passes", async () => {
    const { call, app } = setup();
    const challenge = await createChallenge(call);
    const stream = openStream(call, app, challenge.device_code);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(121_000);

    expect(stream.chunks.at(-1)).toBe('event: status\ndata: {"status":"expired"}\n\n');
    expect(stream.ended).toBe(true);
  });

  it("stops checking storage when the client disconnects", async () => {
    const { call, app } = setup();
    const challenge = await createChallenge(call);
    const stream = openStream(call, app, challenge.device_code);
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
