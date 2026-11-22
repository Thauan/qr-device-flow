# Threat model

This document describes what qr-device-flow protects against, how, and what it does not protect against. It covers the protocol in [PROTOCOL.md](./PROTOCOL.md) and the packages in this repository.

It is a living document. A change to the protocol, to the trust boundaries, or to a control should update it in the same pull request.

## What is being protected

- **The session of the browser that wants to log in.** An attacker must not get a session for a victim's account.
- **The approval of the user's phone.** An approval must mean "I am signing in to this browser right now". It must not be possible to approve someone else's login without knowing what is being approved.
- **The device-flow secrets.** `device_code` (held by the browser) and the binding cookie.

## Actors and trust boundaries

| Actor | Trusted? | Notes |
|---|---|---|
| The browser that displays the QR code | Partly | Trusted with its own session. Its JavaScript runs in the page, so XSS on that page is in scope (see T8). |
| The phone (authenticated mobile app) | Trusted for approval | The phone decides, after the user reviews the request. |
| The person looking at both screens | Trusted, but can be deceived | The main defence against social engineering is the number matching and the consent screen. |
| The integrator's auth system | Trusted | `authenticate` and `issueSession` are integrator code. |
| The network between browser and server | Untrusted | TLS is required in production. |
| Other browsers, other machines, other tabs | Untrusted | |
| A proxy in front of the server | Trusted only when configured | `TRUST_PROXY` must be set explicitly. |

## Protocol overview (what the controls protect)

1. The browser calls `POST /device/code`. The server returns a `device_code` (secret), a `user_code` and a QR code that encodes `verification_uri_complete`. It also returns a two-digit **verification number** and sets the **binding cookie** (`qrdf_bind`, HttpOnly, SameSite=Strict, scoped to the API path, Secure by default). Only the cookie's SHA-256 is stored on the challenge.
2. The phone scans the QR, reads the request details (browser, IP, location, expiry) and shows them on a consent screen. The user types the verification number shown on the browser, then approves or denies.
3. The browser follows the status (`/status`, `/events`) with the binding cookie. When the challenge is approved, the browser calls `/consume` with the binding cookie and gets the session. Consumption is single-use.

## Threats and controls

### T1. QRLjacking: a victim approves an attacker's login

The attacker starts a login, and gets the victim to scan the attacker's QR code with the victim's logged-in phone.

Controls:
- **Number matching.** The phone must type the two-digit number shown on the browser that started the login. A QR code shown from another screen does not show the number, so the approval fails.
- **Hold to approve.** The example's phone page needs a one-second hold on "Approve", so a stray tap or a script's click doesn't approve. This is not a security boundary, but it stops accidental approvals.
- **Requesting site on the consent screen.** The consent screen shows the `Origin` of the page that asked for the login. The value comes from the browser, so it is advisory, but it helps the user spot an unexpected site.
- **Consent screen.** The phone shows the requesting browser's user agent, IP and approximate location, and the expiry. The UI never approves without a review step (covered by an e2e test).
- **Short TTL.** 120 s by default, capped at 600 s.
- **Three wrong numbers deny the challenge.** Brute force against the number is limited to three guesses per challenge.

Residual risk:
- If the attacker's page shows the number and the victim types it without checking the requester details, the attack works. Number matching stops a silent approval. It does not stop a victim who is deliberately deceived into approving.
- Two digits give 1 in 100 odds per guess. Three guesses per challenge is about 3 % per challenge. An attacker who can make the victim's phone send many approvals (which needs the victim's session) could also try many challenges. Rate limiting belongs in the integrator's `/code` and `/approve` routes.

### T2. A copied device code or QR code is used from another browser

An attacker gets the `device_code` (from logs, a referrer, a shared link) or a copy of the QR code, and tries to claim the session elsewhere.

Controls:
- **Binding cookie.** `/status`, `/events` and `/consume` require the cookie that the creating browser received. A `device_code` alone is not enough (tested: `invalid_binding`).
- **The QR code carries only the `user_code`.** It cannot be used to claim a session.

Residual risk:
- Someone with the cookie is the browser that created the login. Its cookie is HttpOnly, so JavaScript on other origins cannot read it.

### T3. Cookie theft or cookie injection

Controls:
- `HttpOnly`: scripts cannot read the cookie.
- `SameSite=Strict`: the cookie is not sent on cross-site requests, which blocks CSRF against `/consume` from other sites.
- `Path` set to the API path: the cookie is sent only to the device routes.
- `Secure` (default): the cookie is sent only over HTTPS. The demo turns it off for plain HTTP (`COOKIE_SECURE=false`), and that must not reach production.

Residual risk:
- Without HTTPS, `Secure` does nothing, and the cookie can be captured on the network. TLS is required.

### T4. Replay of a session

Controls:
- `consume` is compare-and-swap: only the first caller gets the session (tested in the server and in e2e).
- States after consumption are terminal.

### T5. Forged approval (impersonation of the phone)

An attacker calls `/approve` or `/scan` without a logged-in user.

Controls:
- `authenticate` is required for `/scan`, `/approve` and `/deny`. The approving user ID comes from authentication, never from the request body (tested).

Residual risk:
- The demo's `authenticate` treats `Authorization: Bearer <userId>` as the user. That is for the demo only. Integrators must replace it with real session verification.

### T6. Forged requester information

The consent screen shows the browser's IP and location. A client can send any `X-Forwarded-For` header.

Controls:
- `req.ip` honours `X-Forwarded-For` only when `trust proxy` is configured. The demo reads `TRUST_PROXY` from the environment and leaves it unset by default.
- The requester information is advisory. It is never used for an authorization decision.

Residual risk:
- With `TRUST_PROXY` set to a number, a direct client can still send a forged `X-Forwarded-For` and choose the IP shown on the consent screen. Set the number to match the proxy hops you control.

### T7. Cross-origin use

The web client is on one origin and the server on another.

Controls:
- Cookies are sent cross-origin only with `credentials: "include"`, which is an explicit choice. The server's CORS policy must then allow that origin with credentials.
- The default (`same-origin`) keeps the binding cookie away from other origins.

Recommendation: serve the API and the login page under the same origin (for example, through a proxy, as the Next.js example does).

### T8. XSS on the login page

Script injected into the login page can read the session it receives in `onApproved`, and can call `/consume` itself.

Controls:
- The element never renders the session into the DOM (tested).
- The binding cookie is HttpOnly, so injected script cannot copy it.

Residual risk:
- XSS on the login page can still act for the login it is running. It cannot take a session for another login, or read the cookie. Standard XSS defences (CSP, escaping) still apply.

### T9. Denial of service and storage exhaustion

An attacker creates many challenges, or sends many status requests.

Controls:
- Challenges expire after the TTL. Redis storage uses TTLs, so records disappear.
- SSE streams end at a terminal state or at expiry.

Residual risk:
- The library does not rate-limit anything. `POST /device/code`, `GET /device/status`, `GET /device/events` and `POST /device/approve` need rate limits in the integrator's stack. The README says so.

### T10. Race conditions in the storage backend

Controls:
- Status changes go through compare-and-swap, and the Redis Lua script was tested against a real Redis (`redis-storage.integration.test.ts`). An earlier version had a bug that made every swap fail for pending challenges. It is fixed and covered by that test.

Known gap:
- The wrong-number counter is updated with compare-and-swap on the status only. Two wrong numbers sent at the same instant can count as one. The impact is one extra guess per concurrent pair, and the attacker still needs the victim's session to send them.

### T11. CSRF on the mobile endpoints

Controls:
- The mobile endpoints authenticate with a Bearer token in the `Authorization` header, not with a cookie. A cross-site form cannot set that header.

Residual risk:
- An integrator who authenticates the mobile app with cookies must add CSRF protection to `/scan`, `/approve` and `/deny`.

## Verification off (`verification: "none"`)

A server can turn the number check off. Then the consent screen is the only confirmation.

- **What still holds:** the binding cookie (T2, T3), single-use consume (T4), the authenticated approval (T5), the consent screen, and the TTL.
- **What is lost:** the number (T1). A QR code shown from a phishing page can be approved by a victim who doesn't read the requester details. The consent screen is then the only defence against QRLjacking.

The default is `"number"`. Turn the check off only when the consent screen is shown reliably and the users are trained to read it.

## Known limitations (not security boundaries, but worth knowing)

- **One binding cookie per browser and path.** A second login started in another tab replaces the cookie, so the first login can no longer read its status. The first login then ends in an error, and the user starts again. Making this per-tab would need a per-challenge cookie name.
- **The demo's `authenticate` and `COOKIE_SECURE` default are for development only.**
- **WebSocket is not served by the server package yet.** The client supports it. The server only provides polling and SSE.

## Security tests

| Control | Tests |
|---|---|
| Number matching, three-strike denial | `packages/server/test/express.test.ts` (binding and number matching), `examples/express-vanilla/e2e/tests/login.spec.ts` |
| Verification off (`none`) | `packages/server/test/server.test.ts` and `express.test.ts` (verification policy), `examples/express-vanilla/e2e/tests/verification-none.spec.ts` |
| Binding cookie required (status, events, consume) | `packages/server/test/express.test.ts`, `login.spec.ts` (a client without the cookie gets `invalid_binding`) |
| Cookie flags | `express.test.ts` (HttpOnly, SameSite=Strict, Path, Secure), `login.spec.ts` (the browser's cookie) |
| Single-use consume | `packages/server/test/server.test.ts`, `express.test.ts`, e2e |
| Approving user from authentication, not the body | `express.test.ts`, e2e |
| Compare-and-swap on real Redis | `packages/storage-redis/test/redis-storage.integration.test.ts` |
| Token not rendered in the DOM | `packages/element/test/element.test.ts`, e2e |
| Review required before approval | e2e (`nothing can be approved before the request is reviewed`) |

## Reporting

Report vulnerabilities privately to the maintainer before publishing. Do not open a public issue with exploit details.
