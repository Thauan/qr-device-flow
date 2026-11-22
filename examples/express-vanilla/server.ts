import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import QRCode from "qrcode";
import Redis from "ioredis";
import { DeviceFlowServer, type ChallengeStorage } from "@qr-device-flow/server";
import { mountDeviceFlowRoutes } from "@qr-device-flow/server/express";
import { MemoryStorage } from "@qr-device-flow/server/storage/memory";
import { RedisStorage } from "@qr-device-flow/storage-redis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Configuration (all optional) ───────────────────────────────────
//
// PORT          HTTP port. Default 3000.
// PUBLIC_URL    Base URL encoded in the QR code. Default http://localhost:$PORT.
// REDIS_URL     Use Redis for challenges. Default: in-memory (single process only).
// TTL_SECONDS   Challenge lifetime. Default 120 (capped at 600 by the library).
// VERIFICATION  "number" (default) or "none". See THREAT_MODEL.md before using "none".

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, "");
const TTL_SECONDS = process.env.TTL_SECONDS ? Number(process.env.TTL_SECONDS) : undefined;
// VERIFICATION=number (default): the phone types the number shown on the browser.
// VERIFICATION=none: no second check beyond the consent screen (weaker, see THREAT_MODEL.md).
const VERIFICATION = process.env.VERIFICATION === "none" ? "none" : "number";

let storage: ChallengeStorage;
let redis: Redis | undefined;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });
  storage = new RedisStorage({ redis });
  console.log(`storage: redis (${process.env.REDIS_URL.replace(/\/\/.*@/, "//***@")})`);
} else {
  storage = new MemoryStorage();
  console.log("storage: memory");
}

const server = new DeviceFlowServer({
  storage,
  verificationUri: `${PUBLIC_URL}/mobile.html`,
  ttlSeconds: TTL_SECONDS,
  verification: VERIFICATION,
  issueSession: async ({ userId }) => ({
    accessToken: `demo-token-${userId}-${Date.now()}`,
    refreshToken: `demo-refresh-${userId}`,
    expiresIn: 3600,
  }),
});

const app = express();
// COOKIE_SECURE=true when the demo is served over HTTPS. Plain HTTP (the
// default for local demos and the e2e run) needs it off, or browsers drop the
// binding cookie.
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";

// TRUST_PROXY=1 when exactly one proxy you control sits in front of this server
// (e.g. the Next.js app). Then the requester IP comes from X-Forwarded-For.
// Leave it unset otherwise: with no trusted proxy, the header can be forged.
if (process.env.TRUST_PROXY) {
  const value = process.env.TRUST_PROXY;
  app.set("trust proxy", /^\d+$/.test(value) ? Number(value) : value);
}
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

// All /device/* routes: code, status, events (SSE), consume, scan, approve, deny.
mountDeviceFlowRoutes(app, {
  server,
  secureCookies: COOKIE_SECURE,
  // Demo only: the mobile page sends `Authorization: Bearer <userId>`.
  // A real app verifies its own session token here.
  authenticate: (req) => {
    const auth = req.headers.authorization;
    return typeof auth === "string" && auth.startsWith("Bearer ")
      ? auth.slice("Bearer ".length).trim() || null
      : null;
  },
  renderQr: (data) =>
    QRCode.toString(data, {
      type: "svg",
      margin: 0,
      color: { dark: "#1a1b23", light: "#ffffff" },
    }),
});

const httpServer = app.listen(PORT, () => {
  console.log(`QR Device Flow demo running at ${PUBLIC_URL}`);
  console.log(`  Web login:        ${PUBLIC_URL}/`);
  console.log(`  Mobile simulator: ${PUBLIC_URL}/mobile.html`);
});

// Clean shutdown so `docker compose stop` doesn't wait for the timeout.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    httpServer.close(() => {
      redis?.disconnect();
      process.exit(0);
    });
  });
}
