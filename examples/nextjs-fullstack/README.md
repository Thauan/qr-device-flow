# QR Device Flow - Full-Stack Production Demo

A **complete, production-ready** implementation of RFC 8628 QR-based device authorization. Demonstrates:

- ✅ Real Next.js web client with `@qr-device-flow/web`
- ✅ Mobile simulator (Next.js SSR)
- ✅ Express backend with `@qr-device-flow/server`
- ✅ Redis persistent storage
- ✅ NextAuth.js authentication
- ✅ Multi-domain setup (web.localhost, mobile.localhost, api.localhost)
- ✅ Full E2E flow with real tokens

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   localhost setup                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  web.localhost:3000        mobile.localhost:3001   │
│  ┌──────────────────┐      ┌──────────────────┐   │
│  │  Next.js Web     │      │  Next.js Mobile  │   │
│  │  Client          │      │  Simulator       │   │
│  │ (@qr-device-flow/web) │  (SSR + Scanner)  │   │
│  └──────────┬───────┘      └────────┬─────────┘   │
│             │                       │              │
│             └───────────┬───────────┘              │
│                         │                          │
│                  api.localhost:3002               │
│                  ┌──────────────────────┐         │
│                  │  Express Server      │         │
│                  │ (@qr-device-flow/server)  │   │
│                  │  + NextAuth routes   │         │
│                  └──────────┬───────────┘         │
│                             │                      │
│              ┌──────────────┴──────────────┐      │
│              │                             │      │
│          ┌───▼────┐                ┌──────▼──┐   │
│          │ Redis  │                │ Postgres│   │
│          │ (6379) │                │ (5432)  │   │
│          └────────┘                └─────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites
- Node.js 18+
- Docker + Docker Compose
- pnpm or npm

### Step 1: Start Infrastructure

```bash
docker-compose up -d
```

Waits for Redis and PostgreSQL to be healthy.

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Run All Services

```bash
npm run dev
```

Opens:
- **Web login**: http://web.localhost:3000
- **Mobile simulator**: http://mobile.localhost:3001
- **API server**: http://api.localhost:3002

### Step 4: Test the Flow

1. Visit http://web.localhost:3000/login
2. A QR code appears
3. Visit http://mobile.localhost:3001/connect (auto-filled with user code)
4. Click "Approve" or "Deny"
5. Web page automatically logs you in or shows error

## File Structure

```
apps/
├── web/                          # Next.js browser client
│   ├── app/
│   │   ├── login/page.tsx        # QR code page
│   │   ├── dashboard/page.tsx    # Protected page
│   │   ├── api/auth/[...]/       # NextAuth routes
│   │   └── api/device/           # Proxy to Express
│   └── lib/
│       ├── auth.ts               # NextAuth config
│       ├── qr-client.ts          # QRDeviceFlow setup
│       └── session.ts            # Session management
│
├── mobile/                       # Next.js mobile simulator
│   ├── app/
│   │   ├── connect/page.tsx      # QR scanner simulation
│   │   └── api/approve.tsx       # Approval endpoint
│   └── lib/
│       └── auth.ts               # Mobile auth check
│
└── server/                       # Express backend
    ├── routes/
    │   ├── device.ts             # RFC 8628 endpoints
    │   └── auth.ts               # Session issuance
    ├── middleware/
    │   └── auth.ts               # JWT verification
    ├── storage/
    │   └── index.ts              # Redis + Postgres setup
    └── index.ts                  # Server entry
```

## Environment Variables

### `.env.local` (all apps)

```
# Web
NEXT_PUBLIC_API_URL=http://api.localhost:3002
NEXTAUTH_SECRET=your-secret-key
NEXTAUTH_URL=http://web.localhost:3000

# Mobile
NEXT_PUBLIC_API_URL=http://api.localhost:3002
MOBILE_AUTH_TOKEN=demo-mobile-token

# Server
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/qr_device_flow
JWT_SECRET=your-jwt-secret
NEXTAUTH_SECRET=your-secret-key
```

## How It Works

### 1. Browser Initiates (`/login`)
```ts
const flow = new QRDeviceFlow({
  endpoint: 'http://api.localhost:3002/device',
  transport: 'polling',
  onApproved: (session) => {
    // Store token, redirect to dashboard
    signIn('credentials', { token: session.access_token });
  }
});
flow.start({ container: '#qr-box' });
```

### 2. Mobile Scans (`/connect?user_code=ABCD-EFGH`)
```ts
// Mobile reads user_code from URL, shows approval screen
const approved = await userChooses(); // Manual button click
if (approved) {
  await fetch('/api/approve', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${mobileToken}` },
    body: JSON.stringify({ user_code: 'ABCD-EFGH' })
  });
}
```

### 3. Server Processes
```
POST /device/approve
├─ Validate Bearer token (mobile user)
├─ Transition state: pending → scanned → approved
├─ Store userId from token
└─ Return 200 OK

Browser polls /device/status
├─ Sees "approved"
├─ POST /device/consume
├─ Server calls issueSession(userId)
├─ Browser gets JWT token
└─ Redirects to /dashboard
```

### 4. Persistent Storage (Redis)

Challenge state:
```
dc:{deviceCode} → Challenge JSON (TTL: 125s)
uc:{userCode} → deviceCode (TTL: 125s)
```

Sessions:
```
session:{sessionId} → Session JSON (TTL: 3600s)
```

## Testing

### Manual Test Flow
1. Browser: `http://web.localhost:3000/login`
2. Mobile: `http://mobile.localhost:3001/connect`
3. Mobile: Paste user code from browser QR
4. Mobile: Click "Approve"
5. Browser: Automatically shows token ✅

### E2E Tests (Playwright)
```bash
npm run test:e2e
```

Tests the full flow automatically.

### API Tests (Jest)
```bash
npm run test
```

Unit tests for routes, auth, storage.

## Production Considerations

### HTTPS Required
```
# In production, all endpoints MUST use HTTPS
# The library refuses HTTP except on localhost
export NEXTAUTH_URL=https://login.example.com
export NEXT_PUBLIC_API_URL=https://api.example.com
```

### Rate Limiting
```ts
// Add on POST /device/code to prevent DoS
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5, // 5 requests per IP
});

app.post('/device/code', limiter, handleCreateChallenge);
```

### Custom Auth Provider
Replace the mock `issueSession()` callback with your auth system:

```ts
const server = new DeviceFlowServer({
  storage: redisStorage,
  issueSession: async ({ userId, challenge }) => {
    // Generate real JWT from your auth system
    const user = await db.users.findById(userId);
    const token = await jwt.sign({ sub: userId, iat: Date.now() });
    return {
      access_token: token,
      refresh_token: generateRefreshToken(userId),
      expires_in: 3600
    };
  }
});
```

## Troubleshooting

### "Connection refused" to Redis/Postgres
```bash
docker-compose logs redis postgres
# Check if containers are healthy
docker-compose ps
```

### QR code not appearing on mobile
- Check `NEXT_PUBLIC_API_URL` is set correctly
- Browser console: any CORS errors?
- Mobile: visit http://mobile.localhost:3001/connect manually

### Token not being issued
- Check server logs: `docker-compose logs server`
- Verify JWT_SECRET is set
- Check mobile auth token is valid

## References

- **RFC 8628**: https://www.rfc-editor.org/rfc/rfc8628
- **@qr-device-flow/web**: Client browser integration
- **@qr-device-flow/server**: Backend orchestrator
- **NextAuth.js**: Session management

## License

MIT
