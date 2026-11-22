# Express demo

A complete QR login flow: a web page asks for a login, a "phone" page (`mobile.html`) approves it, and the web page gets a session. It uses the real packages from this repo:

- `@qr-device-flow/server` with `mountDeviceFlowRoutes` (every `/device/*` route)
- `@qr-device-flow/web` in the browser (`src/client.ts`, bundled to `public/app.js`)
- `@qr-device-flow/storage-redis` when `REDIS_URL` is set

## Run it

### With Docker (Redis + server)

```bash
docker compose up --build
```

Open http://localhost:3000. The mobile page is http://localhost:3000/mobile.html. Enter any user ID (for example `alice`) and approve.

### Without Docker

```bash
pnpm install                                # from the repository root
pnpm --filter qr-device-flow-example run dev  # or: cd examples/express-vanilla && pnpm run dev
```

Storage is in-memory, which is fine for one process.

## Framework pages

Besides the login page and the phone page, the e2e suite covers `<qr-device-login>` on four pages:

| Page | Served by | Notes |
|---|---|---|
| `/element.html` | Express | plain HTML |
| `/react.html` | Express | React 19 |
| `/vue.html` | Express | Vue 3 |
| Next.js app | `examples/nextjs-element` (port 3200) | client-only element; `/device/*` is proxied to the API by a route handler (`API_URL`) |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `PUBLIC_URL` | `http://localhost:$PORT` | Base URL encoded in the QR code |
| `REDIS_URL` | — (in-memory) | Redis for challenges |
| `TTL_SECONDS` | `120` | Challenge lifetime (the library caps it at 600) |
| `API_URL` (Next.js app) | `http://localhost:3100` | Where the Next.js `/device` proxy forwards requests |
| `VERIFICATION` | `number` | `number` (the phone types the number shown on the browser) or `none` (consent screen only; weaker against QR phishing, see THREAT_MODEL.md) |
| `TRUST_PROXY` | — | Set to `1` when one proxy you control is in front of the server. The requester IP then comes from `X-Forwarded-For`. Leave unset otherwise: the header can be forged |

Pages accept `?transport=sse` (default) or `?transport=polling`.

## Credits

The login and phone pages use a visual style adapted from a CodePen pen by Abdelrhman Said (MIT). See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## End-to-end tests (Playwright)

The suite is in `e2e/`, and covers the full flow for both SSE and polling:

- the QR code on the login page is decoded from its image (`jsqr`), and must point to `mobile.html?user_code=<the code shown>`;
- the "phone" is a second browser context that runs the real `DeviceFlowMobileClient` from `@qr-device-flow/react-native/client` (bundled as `public/mobile-app.js`): it reviews the request (consent screen), then approves or denies;
- the phone cannot approve before reviewing, and unknown codes are reported as errors;
- retry issues a new code, and an unanswered login expires.

What the browser cannot cover is the camera (`QRScanner`) and the native app. Those need a device or simulator test (Maestro or Detox).

```bash
# On the host: Playwright starts the server itself (in-memory storage, TTL 30 s).
pnpm run test:e2e

# Against a running server, for example docker compose:
docker compose --profile e2e run --rm e2e   # starts the stack and runs everything
```

The Docker run uses the official Playwright image for Chromium. Its report and traces stay inside the container; copy them out with `docker cp` if you need them.

## Notes

- Keep the Redis service name (`server` in `docker-compose.yml`) out of the `.app` TLD. Chrome forces `https://` on `.app` hosts (HSTS preload), so `http://app:3000` fails.
- The demo authenticates the phone with `Authorization: Bearer <userId>`. That is for the demo only. Replace `authenticate` in `server.ts` with your real session check, and `getAuthToken` in `src/mobile.ts` with your app's session token.
- The repo uses pnpm (pinned in the root `package.json`). Internal dependencies use `workspace:*`, and `pnpm-lock.yaml` is committed. Dockerfiles and CI install with `--frozen-lockfile`.
