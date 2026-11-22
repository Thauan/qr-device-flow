# @qr-device-flow/server

Server side of the [QR device flow](../../README.md): challenge storage, the protocol state machine, browser binding and number matching. It is HTTP-agnostic. For Express, `mountDeviceFlowRoutes` registers every endpoint in one call.

```ts
import express from "express";
import { DeviceFlowServer } from "@qr-device-flow/server";
import { mountDeviceFlowRoutes } from "@qr-device-flow/server/express";
import { MemoryStorage } from "@qr-device-flow/server/storage/memory"; // use @qr-device-flow/storage-redis in production

const server = new DeviceFlowServer({
  storage: new MemoryStorage(),
  verificationUri: "https://app.example.com/connect",
  issueSession: async ({ userId }) => ({ accessToken: `token-for-${userId}`, expiresIn: 3600 }),
});

const app = express();
app.use(express.json());
mountDeviceFlowRoutes(app, {
  server,
  authenticate: (req) => verifyBearerToken(req.headers.authorization) ?? null,
});
app.listen(3000);
```

## Entry points

| Import | Contents |
|---|---|
| `@qr-device-flow/server` | `DeviceFlowServer`, storage types |
| `@qr-device-flow/server/express` | `mountDeviceFlowRoutes` (structural types, no `express` dependency) |
| `@qr-device-flow/server/storage/memory` | `MemoryStorage`, for development and tests |

## Security notes

- `authenticate` decides who the phone is. The approving user ID never comes from the request body.
- The browser binding cookie (`qrdf_bind`) is HttpOnly, SameSite=Strict, scoped to the device path and `Secure` by default. Keep `secureCookies` on in production (HTTPS).
- Set `trust proxy` only when a proxy you control sits in front of the server. The requester IP on the consent screen comes from `X-Forwarded-For` in that case.
- Verification is on by default: the phone must type the two-digit number shown on the browser. `verification: "none"` turns that check off, and the consent screen becomes the only confirmation (see THREAT_MODEL.md before doing that).
- The library does not rate-limit. Put rate limits on `POST /device/code`, `GET /device/status`, `GET /device/events` and `POST /device/approve`.

See [PROTOCOL.md](../../PROTOCOL.md) for every endpoint and [THREAT_MODEL.md](../../THREAT_MODEL.md) for what is and isn't protected.
