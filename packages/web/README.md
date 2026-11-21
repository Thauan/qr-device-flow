# @qr-device-flow/web

Browser client for [QR device flow](../../README.md) authentication. It renders a QR code, watches the challenge, and claims the session once a logged-in phone approves it.

## Install

```bash
npm install @qr-device-flow/web
```

## Usage

### DOM mode

```ts
import { QRDeviceFlow } from "@qr-device-flow/web";

const flow = new QRDeviceFlow({
  endpoint: "https://api.example.com/device",
  transport: "polling", // "polling" | "sse" | "websocket"
  onStateChange: (status) => console.log(status),
  onApproved: ({ accessToken, refreshToken, expiresIn }) => {
    // Store the session with your auth system.
  },
  onError: (err) => console.error(err),
});

await flow.start({ container: "#qr-box" });
```

### Headless mode

```ts
const { qrDataUrl, userCode, expiresAt } = await flow.startHeadless();
```

Use `qrDataUrl` in an `<img>` or render your own UI. `userCode` is the fallback to type on the phone when the camera can't read the QR.

### Options

| Option | Default | Description |
|---|---|---|
| `endpoint` | — | Base URL of the device-flow server, e.g. `https://api.example.com/device`. |
| `transport` | `"polling"` | How status changes are observed. See below. |
| `autoRegenerate` | `false` | Create a new challenge automatically after expiry. In headless mode, pair it with `onRegenerate`. |
| `onRegenerate` | — | Headless mode: called with the new `HeadlessResult` (QR, user code, expiry) after an automatic regeneration, so you can redraw the QR. |
| `qrSize` | `256` | QR code size in pixels. |
| `onStateChange` | — | Called on every status change. |
| `onApproved` | — | Called once, after the session is claimed. |
| `onError` | — | Called on network failures, protocol errors, and denial. |

Call `flow.destroy()` when the login screen goes away. It stops polling and clears the container.

## Status lifecycle

`pending` → `scanned` → `approved` → session claimed (`onApproved`)

The flow ends on `approved`, `denied`, `expired`, or `approved-consumed`. Monitoring stops at that point.

- The client enforces the challenge TTL itself. If the server stops reporting the challenge, the client still moves to `expired` when `expires_in` elapses.
- `400 expired_token` from the status endpoint is reported as `expired`, not as an error.
- `denied` is reported both through `onStateChange` and as an error (`"Authorization denied by user"`).

## Transports

| Transport | Endpoint used | Notes |
|---|---|---|
| `polling` | `GET {endpoint}/status?device_code=…` | Default. Works everywhere. Respects the server's `interval`, never faster than 5 s. |
| `sse` | `GET {endpoint}/events?device_code=…` | Expects `event: status` messages with `{"status": "…"}` data. |
| `websocket` | `{endpoint}/ws?device_code=…` (scheme `ws`/`wss`) | Expects `{"status": "…"}` JSON messages. Retries up to 3 times with back-off. |

> **Note:** `mountDeviceFlowRoutes` from `@qr-device-flow/server/express` registers the `polling` and `sse` routes for you. The `websocket` transport still needs a route you write yourself. Use `sse` unless you have a specific reason to need WebSocket.

## Requirements

- Browser with `fetch` (and `EventSource` / `WebSocket` for those transports).
- The page must be served over HTTPS in production, since the QR encodes a URL to your app.
