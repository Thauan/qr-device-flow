# qr-device-flow

![CI](https://github.com/YOUR_ORG/qr-device-flow/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node 22+](https://img.shields.io/badge/node-22%2B-brightgreen.svg)

Open-source library for QR-based cross-device authentication, implementing [RFC 8628 (OAuth 2.0 Device Authorization Grant)](https://www.rfc-editor.org/rfc/rfc8628).

User has an authenticated mobile app, scans a QR code displayed on a web page, approves on their phone, and the browser is automatically logged in -- no password typed in the browser. Same pattern as WhatsApp Web.

- **Not a SaaS.** No vendor lock-in, runs on your infrastructure.
- **RFC 8628 compliant.** Same spec smart TVs and CLIs use, but with QR UX instead of typed codes.
- **Framework-agnostic.** Pluggable storage, pluggable session issuance, no opinion on your auth stack.

## Packages

| Package | Description | Status |
|---|---|---|
| `@qr-device-flow/core` | Types, state machine, code generators | Stable |
| `@qr-device-flow/server` | HTTP-agnostic server engine, pluggable storage | Stable |
| `@qr-device-flow/web` | Browser client: QR rendering, polling/SSE/WebSocket | Stable |
| `@qr-device-flow/react-native` | Mobile client: QR scanner, approval flow | Stable |
| `@qr-device-flow/storage-redis` | Redis storage with atomic CAS via Lua script | Stable |

## State machine

```
pending ──SCAN──▶ scanned ──APPROVE──▶ approved ──CONSUME──▶ approved-consumed
   │                 │                      │
   │                 └──DENY──▶ denied      │
   │                                        │
   └──EXPIRE──▶ expired ◀──(TTL elapsed)────┘
```

Terminal states: `approved-consumed`, `denied`, `expired`. The `scanned` state is optional -- `APPROVE` can be applied directly from `pending` (fast path).

## Quick start

### 1. Server (Express)

```ts
import express from "express";
import { DeviceFlowServer } from "@qr-device-flow/server";
import { MemoryStorage } from "@qr-device-flow/server/storage/memory";

const storage = new MemoryStorage();
const server = new DeviceFlowServer({
  storage,
  verificationUri: "https://app.example.com/connect",
  issueSession: async ({ userId }) => ({
    accessToken: `token-for-${userId}`,
    refreshToken: `refresh-for-${userId}`,
    expiresIn: 3600,
  }),
});

const app = express();
app.use(express.json());

app.post("/device/code", async (req, res) => {
  const result = await server.createChallenge({
    userAgent: req.headers["user-agent"],
    ip: req.ip,
  });
  res.json(result);
});

app.get("/device/status", async (req, res) => {
  const challenge = await server.getStatus(req.query.device_code as string);
  res.json({ status: challenge.status });
});

app.post("/device/consume", async (req, res) => {
  const session = await server.consume(req.body.device_code);
  res.json(session);
});

app.post("/device/approve", async (req, res) => {
  // userId MUST come from the authenticated session, never from the body
  const userId = req.headers.authorization; // your auth logic here
  await server.approve(req.body.user_code, userId);
  res.json({ ok: true });
});

app.listen(3000);
```

### 2. Browser (`@qr-device-flow/web`)

```ts
import { QRDeviceFlow } from "@qr-device-flow/web";

const flow = new QRDeviceFlow({
  endpoint: "https://api.example.com/device",
  transport: "polling",
  onApproved: (session) => {
    console.log("Logged in!", session);
  },
  onError: (err) => console.error(err),
});

// Render QR into a DOM element
flow.start({ container: "#qr-box" });

// Or headless (bring your own UI)
const { qrDataUrl, userCode, expiresAt } = await flow.startHeadless();
```

### 3. Mobile (React Native)

```tsx
import { DeviceFlowMobileClient } from "@qr-device-flow/react-native";
import { QRScanner } from "@qr-device-flow/react-native";

const client = new DeviceFlowMobileClient({
  baseUrl: "https://api.example.com/device",
  getAuthToken: () => userToken,
});

<QRScanner
  onScan={async (userCode) => {
    const details = await client.scan(userCode);
    // Show consent screen with details.requesterInfo
    const approved = await showConsentScreen(details);
    if (approved) {
      await client.approve(userCode);
    } else {
      await client.deny(userCode);
    }
  }}
/>;
```

Or skip the SDK entirely -- the protocol is plain REST. See [PROTOCOL.md](./PROTOCOL.md) for the full endpoint reference.

## Development

**Prerequisites:** Node 22+, pnpm

```bash
pnpm install        # bootstrap all packages
pnpm build          # build all packages
pnpm test           # run 109 tests
pnpm typecheck      # verify types across the monorepo
```

### Running the demo

```bash
cd examples/express-vanilla
pnpm install
pnpm dev
```

Opens a web page with a QR code and a mobile simulator side-by-side on `localhost:3000`.

## Architecture decisions

- **RFC 8628 compliance** -- reuses a proven standard instead of inventing a custom protocol.
- **TTL capped at 600s** -- limits the phishing window. Integrators can lower it, never raise it above the cap.
- **No auto-approve** -- a consent screen showing `requesterInfo` (browser, OS, location) is mandatory. This is architectural, not configurable.
- **`compareAndSwap` atomicity** -- storage layer guarantees single-use consumption, even under concurrent requests.
- **Dual export in core** -- `@qr-device-flow/core` exposes only types/constants for client bundles; `@qr-device-flow/core/server` adds the state machine and code generators.
- **`issueSession` is your callback** -- the library never emits tokens. It signals "this user approved this challenge" and your auth system issues the session.

## Security

- **HTTPS required in production.** The library refuses to operate over plain HTTP except on `localhost`.
- **`userId` from session, not body.** The mobile app's `Authorization` header is the source of truth. Never trust a `user_id` field in the request body.
- **Single-use tokens.** `compareAndSwap` ensures only one consumer claims the session.
- **Rate limiting.** The server does not enforce rate limits -- integrators should add rate limiting on `POST /device/code` to prevent abuse.

## Native clients

The flow is plain REST. Any HTTP client works -- no SDK required.

See [PROTOCOL.md](./PROTOCOL.md) for the full endpoint specification with examples in Swift, Kotlin, and cURL.

## License

[MIT](./LICENSE)
