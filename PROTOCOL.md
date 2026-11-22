# QR Device Flow — HTTP Protocol Reference

Protocol specification for the QR-based device authorization flow, based on [RFC 8628 (OAuth 2.0 Device Authorization Grant)](https://www.rfc-editor.org/rfc/rfc8628).

This document describes the REST endpoints that any client (browser, iOS, Android, CLI) can use to implement the flow. No SDK required.

---

## Overview

Two actors interact with the server:

| Actor | Role | Endpoints used |
|---|---|---|
| **Browser** (or smart TV, CLI) | Displays QR and number, polls for approval, claims session | `POST /device/code`, `GET /device/status`, `GET /device/events`, `POST /device/consume` (the binding cookie is required on all but `/code`) |
| **Mobile app** (or any authenticated client) | Scans QR, reviews request, types the number, approves or denies | `POST /device/scan`, `POST /device/approve`, `POST /device/deny` |

## Browser binding and number matching

Two controls make a leaked QR code or device code worth little to an attacker. Both are part of the protocol, not options.

**Browser binding.** The `POST /device/code` response sets a cookie, `qrdf_bind`, that only the browser which created the challenge receives. The cookie is `HttpOnly`, `SameSite=Strict`, scoped to the API path, and `Secure` by default. The server stores only its SHA-256 hash. `GET /device/status`, `GET /device/events` and `POST /device/consume` require the cookie, so a `device_code` copied from the browser cannot claim a session anywhere else. A request without the right cookie gets `400 invalid_binding`.

**Number matching.** The `POST /device/code` response includes a two-digit `verification_number`, shown on the browser next to the QR code. The phone must send that number with `POST /device/approve`. A wrong number is rejected (`invalid_verification_number`), and the third wrong number denies the challenge. A QR code shown from another screen does not show the number, so an approval from it fails.

**Verification policy.** The server decides the second check, with its `verification` option: `"number"` (the default, described above) or `"none"`. With `"none"`, `/code` returns `"verification_number": null`, `/scan` returns `"verification": "none"`, and `/approve` doesn't need a number. The consent screen (browser, IP, location) becomes the only confirmation. That is weaker against QR phishing, so it is an explicit choice. The binding cookie still applies in both modes.

Cross-origin browsers must send credentials for the cookie to be included. Serving the API and the login page under the same origin is the simplest setup.

See [THREAT_MODEL.md](./THREAT_MODEL.md) for what these controls do and do not cover.

## State machine

```
pending ──SCAN──▶ scanned ──APPROVE──▶ approved ──CONSUME──▶ approved-consumed
   │                 │                      │
   │                 └──DENY──▶ denied      │
   │                                        │
   └──EXPIRE──▶ expired ◀──(TTL elapsed)────┘
```

Terminal states: `approved-consumed`, `denied`, `expired`. No further transitions allowed.

The `scanned` state is optional — `APPROVE` can be applied directly from `pending` (fast path).

---

## Endpoints

### `POST /device/code`

Creates a new authorization challenge. Called by the **browser** to initiate the flow.

**Request:**
```http
POST /device/code
Content-Type: application/json

{
  "requester_info": {                 // optional
    "userAgent": "Chrome/120",
    "ip": "203.0.113.42",
    "approxLocation": "Salvador, BR"
  }
}
```

If `requester_info` is omitted, the server should populate it from the HTTP request headers.

**Response — `200 OK`:**
```json
{
  "device_code": "a1b2c3...base64url...43chars",
  "user_code": "ABCD-EFGH",
  "verification_uri": "https://app.example.com/connect",
  "verification_uri_complete": "https://app.example.com/connect?user_code=ABCD-EFGH",
  "expires_in": 120,
  "interval": 5,
  "verification_number": "07"
}
```

With `verification: "none"` on the server, `verification_number` is `null`.

The response also sets the binding cookie:

```http
Set-Cookie: qrdf_bind=<secret>; Path=/device; HttpOnly; SameSite=Strict; Max-Age=120; Secure
```

| Field | Type | Description |
|---|---|---|
| `device_code` | `string` | Opaque 43-char token. Used by the browser to poll and consume. Never shown to the user. |
| `user_code` | `string` | Short code in `XXXX-XXXX` format (alphabet: `ABCDEFGHJKMNPQRSTUVWXYZ23456789`). Shown as fallback if camera fails. |
| `verification_uri` | `string` | Base URL where the mobile app lands. |
| `verification_uri_complete` | `string` | Full URL with `user_code` embedded. Encode this in the QR code. |
| `expires_in` | `number` | Challenge lifetime in seconds (max 600). |
| `interval` | `number` | Minimum polling interval in seconds (always 5). |
| `verification_number` | `string \| null` | Two digits (`"00"`–`"99"`). Shown on the browser, and the phone must send it with `/approve`. `null` when the server runs with `verification: "none"`. |

---

### `GET /device/status`

Polls the current status of a challenge. Called by the **browser** at the `interval` rate. The request must carry the binding cookie set by `POST /device/code`; otherwise the response is `400 invalid_binding`.

**Request:**
```http
GET /device/status?device_code=a1b2c3...43chars
```

**Response — `200 OK`:**
```json
{
  "status": "pending"
}
```

| `status` value | Meaning | Browser action |
|---|---|---|
| `pending` | Waiting for scan | Keep polling |
| `scanned` | Phone detected, awaiting user confirmation | Show "confirm on device" UI, keep polling |
| `approved` | User approved — ready to consume | Call `POST /device/consume` |
| `denied` | User rejected | Show error, offer retry |
| `expired` | TTL elapsed | Show error, offer retry |
| `approved-consumed` | Already consumed by another request | Show error |

**Error — `400`:**
```json
{
  "error": "expired_token",
  "code": "expired_token"
}
```

---

### `GET /device/events`

Server-Sent Events alternative to polling `/device/status`. Called by the **browser** with `EventSource`. The server pushes a `status` event whenever the challenge changes and closes the stream on a terminal state (`approved`, `denied`, `expired`, `approved-consumed`).

**Request:**
```http
GET /device/events?device_code=a1b2c3...43chars
Accept: text/event-stream
```

**Response — `200 OK`, `Content-Type: text/event-stream`:**
```
event: status
data: {"status":"pending"}

event: status
data: {"status":"scanned"}

event: status
data: {"status":"approved"}

```

- Each `status` event carries the same `status` values as `/device/status`.
- `: ping` comment lines are sent about every 15 s to keep proxies from closing idle connections.
- An unknown or expired `device_code` produces a single `expired` event, not an HTTP error.
- A malformed `device_code` returns `400 invalid_device_code` before the stream opens.
- The binding cookie is required. A request without it gets `400 invalid_binding` before the stream opens. Browsers send the cookie automatically on same-origin requests.
- The `EventSource` reconnects on its own. The stream does not need `Last-Event-ID`: a reconnect receives the current status first.

---

### `POST /device/consume`

Claims the session after approval. Called by the **browser** exactly once. Atomic — only the first caller succeeds. The request must carry the binding cookie (`400 invalid_binding` otherwise).

**Request:**
```http
POST /device/consume
Content-Type: application/json

{
  "device_code": "a1b2c3...43chars"
}
```

**Response — `200 OK`:**
```json
{
  "access_token": "eyJhbG...",
  "refresh_token": "dGhpcyBpcyBh...",
  "expires_in": 3600
}
```

The response shape depends on the integrator's `issueSession` callback. The fields above are conventional but the integrator may add or omit fields.

**Error codes:**

| Code | HTTP | When |
|---|---|---|
| `authorization_pending` | 400 | Challenge not yet approved |
| `authorization_denied` | 400 | User denied on mobile |
| `expired_token` | 400 | Challenge TTL elapsed |
| `already_consumed` | 400 | Session was already claimed |
| `invalid_device_code` | 400 | Malformed device_code |
| `invalid_binding` | 400 | The request doesn't carry the binding cookie of the browser that created the challenge |

---

### `POST /device/scan`

Marks a challenge as scanned. Called by the **mobile app** after reading the QR. This is an optional UX step — the flow works without it.

**Request:**
```http
POST /device/scan
Content-Type: application/json
Authorization: Bearer <mobile_user_token>

{
  "user_code": "ABCD-EFGH"
}
```

The `user_code` accepts any format: with/without dash, lowercase, surrounding spaces. The server normalizes it.

**Response — `200 OK`:**
```json
{
  "ok": true
}
```

The reference server (`mountDeviceFlowRoutes`) returns `requester_info` and `expires_at` for the consent screen. `requester_info.origin` is the `Origin` header of the `POST /device/code` request (the site that asked for the login). It is advisory: the browser sends it, so the consent screen shows it to the user and no decision depends on it.
```json
{
  "ok": true,
  "requester_info": {
    "userAgent": "Chrome/120",
    "ip": "203.0.113.42",
    "approxLocation": "Salvador, BR"
  },
  "expires_at": 1700000120000
}
```

**Error codes:**

| Code | HTTP | When |
|---|---|---|
| `invalid_user_code` | 400 | Code doesn't match the expected format |
| `expired_token` | 400 | Challenge expired |
| `invalid_transition` | 400 | Challenge already scanned/approved/denied |

---

### `POST /device/approve`

Approves the challenge, binding it to the authenticated mobile user. The `/scan` response says whether a number is needed (`verification`). Called by the **mobile app** after the user reviews `requester_info`, types the `verification_number` shown on the browser, and taps "Approve".

**Request:**
```http
POST /device/approve
Content-Type: application/json
Authorization: Bearer <mobile_user_token>

{
  "user_code": "ABCD-EFGH",
  "verification_number": "07"
}
```

A wrong `verification_number` leaves the challenge pending and returns `400 invalid_verification_number`. The third wrong number denies the challenge, so later approvals fail with `invalid_transition`.

When the server runs with `verification: "none"`, the `verification_number` field is not needed (and is ignored if sent).

> **Security requirement:** The `userId` MUST come from the authenticated session (the `Authorization` header), never from the request body. The server extracts the user identity from the token, not from client-supplied data.

**Response — `200 OK`:**
```json
{
  "ok": true
}
```

**Error codes:**

| Code | HTTP | When |
|---|---|---|
| `invalid_user_code` | 400 | Code doesn't match the expected format |
| `invalid_verification_number` | 400 | Missing or wrong number (the third wrong number denies the challenge) |
| `expired_token` | 400 | Challenge expired |
| `invalid_transition` | 400 | Challenge already approved/denied/consumed |

---

### `POST /device/deny`

Denies the challenge. Called by the **mobile app** when the user taps "Deny".

**Request:**
```http
POST /device/deny
Content-Type: application/json
Authorization: Bearer <mobile_user_token>

{
  "user_code": "ABCD-EFGH"
}
```

**Response — `200 OK`:**
```json
{
  "ok": true
}
```

**Error codes:** Same as `/device/approve`.

---

## Error response format

All error responses follow the same shape:

```json
{
  "error": "Human-readable message",
  "code": "machine_readable_code"
}
```

Error codes (from RFC 8628 where applicable):

| Code | Description |
|---|---|
| `authorization_pending` | The user hasn't acted yet — keep polling |
| `authorization_denied` | The user denied the request |
| `expired_token` | The challenge TTL has elapsed |
| `already_consumed` | The session was already claimed |
| `invalid_device_code` | The `device_code` format is invalid |
| `invalid_user_code` | The `user_code` format is invalid |
| `invalid_verification_number` | The number typed on the phone doesn't match (or is malformed) |
| `invalid_binding` | The request doesn't carry the browser-binding cookie |
| `invalid_transition` | The requested action isn't allowed in the current state |

---

## Sequence diagrams

### Happy path

```
Browser                    Server                    Mobile App
   │                         │                           │
   ├─POST /device/code──────▶│                           │
   │◀── device_code, QR ─────┤                           │
   │                         │                           │
   │  render QR              │                           │
   │                         │      scan QR              │
   │                         │◀──POST /device/scan───────┤
   │                         ├──── { ok: true } ────────▶│
   │                         │                           │
   ├─GET /device/status─────▶│     show consent screen   │
   │◀── { status: scanned } ─┤                           │
   │                         │  user types number, taps  │
   │                         │◀──POST /device/approve────┤
   │                         ├──── { ok: true } ────────▶│
   │                         │                           │
   ├─GET /device/status─────▶│                           │
   │◀── { status: approved } ┤                           │
   │                         │                           │
   ├─POST /device/consume───▶│                           │
   │◀── { access_token } ────┤                           │
   │                         │                           │
   │  user is logged in      │                           │
```

### Fast path (no scan event)

```
Browser                    Server                    Mobile App
   │                         │                           │
   ├─POST /device/code──────▶│                           │
   │◀── device_code, QR ─────┤                           │
   │                         │      scan + approve       │
   │                         │◀──POST /device/approve────┤
   │                         │                           │
   ├─GET /device/status─────▶│                           │
   │◀── { status: approved } ┤                           │
   │                         │                           │
   ├─POST /device/consume───▶│                           │
   │◀── { access_token } ────┤                           │
```

### Denial

```
Browser                    Server                    Mobile App
   │                         │                           │
   ├─POST /device/code──────▶│                           │
   │◀── device_code, QR ─────┤                           │
   │                         │◀──POST /device/deny───────┤
   │                         │                           │
   ├─GET /device/status─────▶│                           │
   │◀── { status: denied } ──┤                           │
   │                         │                           │
   │  show "denied" message  │                           │
```

---

## Security considerations

1. **HTTPS required in production.** The library does not enforce it. The `Secure` cookie flag, and the trust in the QR code's destination, depend on TLS. Deploy the server behind HTTPS.

2. **`userId` from session, not body.** The mobile app's `Authorization` header is the source of truth for who is approving. Never trust a `user_id` field in the request body in production — the POC example does this for simplicity only.

3. **No auto-approve.** The mobile app MUST show a consent screen with `requester_info` (browser, OS, location) before approving. This is an architectural decision, not configurable.

4. **Single-use tokens.** `compareAndSwap` guarantees that only one consumer claims the session, even under concurrent requests.

   **Browser binding.** The session can only be claimed with the binding cookie of the browser that created the challenge. A copied `device_code` is not enough.

   **Number matching.** Approval needs the number shown on the browser. A QR code shown elsewhere can't be approved silently.

5. **Short TTL.** Challenges expire in 120s by default (max 600s). This limits the phishing window.

6. **Rate limiting.** The server does not enforce rate limits — integrators should add rate limiting on `POST /device/code` to prevent DoS.

7. **User code alphabet.** Ambiguous characters (`0/O`, `1/I/L`) are excluded from user codes to prevent confusion when typing manually.

---

## Native implementation guide

### iOS (Swift)

```swift
// 1. Extract user_code from scanned QR URL
let url = URL(string: qrData)!
let userCode = URLComponents(url: url, resolvingAgainstBaseURL: false)?
    .queryItems?.first(where: { $0.name == "user_code" })?.value ?? ""

// 2. Notify server of scan
var scanReq = URLRequest(url: URL(string: "\(baseURL)/device/scan")!)
scanReq.httpMethod = "POST"
scanReq.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
scanReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
scanReq.httpBody = try JSONEncoder().encode(["user_code": userCode])
let (_, _) = try await URLSession.shared.data(for: scanReq)

// 3. Show consent screen with requester_info, then:
// 3. Approve, with the two-digit number the user typed from the login screen
var approveReq = URLRequest(url: URL(string: "\(baseURL)/device/approve")!)
approveReq.httpMethod = "POST"
approveReq.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
approveReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
approveReq.httpBody = try JSONEncoder().encode(["user_code": userCode, "verification_number": typedNumber])
let (_, _) = try await URLSession.shared.data(for: approveReq)
```

### Android (Kotlin)

```kotlin
// 1. Extract user_code from scanned QR URL
val uri = Uri.parse(qrData)
val userCode = uri.getQueryParameter("user_code") ?: return

// 2. Notify server of scan
val client = OkHttpClient()
val scanBody = """{"user_code":"$userCode"}""".toRequestBody("application/json".toMediaType())
client.newCall(Request.Builder()
    .url("$baseURL/device/scan")
    .post(scanBody)
    .addHeader("Authorization", "Bearer $authToken")
    .build()
).execute()

// 3. Show consent screen, then:
// Approve, with the two-digit number the user typed from the login screen
val approveBody = """{"user_code":"$userCode","verification_number":"$typedNumber"}""".toRequestBody("application/json".toMediaType())
client.newCall(Request.Builder()
    .url("$baseURL/device/approve")
    .post(approveBody)
    .addHeader("Authorization", "Bearer $authToken")
    .build()
).execute()
```

---

## Compatibility with RFC 8628

This protocol follows RFC 8628 with these extensions: the `scanned` state (between `pending` and `approved`), the browser-binding cookie, and the verification number on approval. A standard RFC 8628 client that ignores the `scanned` state will still work for polling, but it can't complete approval without the verification number, and it needs the binding cookie to read the status.

The `user_code` and `device_code` fields match the RFC naming. The `verification_uri` and `verification_uri_complete` follow RFC 8628 §3.2. The `interval` field follows RFC 8628 §3.5.
