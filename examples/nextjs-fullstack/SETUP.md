# Full-Stack Demo - Setup Guide

Complete step-by-step guide to running the QR Device Flow full-stack demo locally.

## Prerequisites

- **Node.js 18+** — Check: `node --version`
- **Docker + Docker Compose** — For Redis and PostgreSQL
- **pnpm** (recommended) or **npm**

## Step 1: Setup Environment

```bash
cd examples/nextjs-fullstack

# Copy environment template
cp .env.example .env.local

# Or create manually:
cat > .env.local << 'EOF'
NEXTAUTH_SECRET=demo-secret-key-change-in-production
NEXTAUTH_URL=http://web.localhost:3000
NEXT_PUBLIC_API_URL=http://api.localhost:3002
REDIS_URL=redis://localhost:6379
PORT=3002
EOF
```

## Step 2: Add Local Domains to `/etc/hosts`

For multi-domain testing, add these to your `/etc/hosts`:

```bash
sudo nano /etc/hosts

# Add these lines:
127.0.0.1 web.localhost
127.0.0.1 mobile.localhost
127.0.0.1 api.localhost
```

On Windows, edit `C:\Windows\System32\drivers\etc\hosts` as Administrator.

## Step 3: Start Infrastructure (Docker)

```bash
docker-compose up -d

# Verify:
docker-compose ps
```

Should show `redis` and `postgres` containers running ✅

## Step 4: Install Dependencies

```bash
npm install
# or
pnpm install
```

This installs dependencies for the root monorepo and all apps.

## Step 5: Run All Services

```bash
npm run dev
# or
pnpm dev
```

You should see:

```
> next dev -p 3000
  ▲ Next.js 14.0.0
  - Local:        http://web.localhost:3000

> next dev -p 3001
  ▲ Next.js 14.0.0
  - Local:        http://mobile.localhost:3001

> tsx --watch src/index.ts
  ✓ QR Device Flow server running on http://api.localhost:3002
    POST   /device/code      - Create challenge
    GET    /device/status    - Poll status
    POST   /device/scan      - Mark scanned
    POST   /device/approve   - Approve challenge
    POST   /device/deny      - Deny challenge
    POST   /device/consume   - Consume session
    GET    /health           - Health check
```

## Step 6: Test the Flow

Open **two windows side-by-side**:

### Window 1: Browser
```
http://web.localhost:3000/login
```

You'll see:
- QR code displayed
- User code (fallback)
- Status: "Waiting for scan..."

### Window 2: Mobile Simulator
```
http://mobile.localhost:3001/connect
```

You'll see:
- Phone frame mockup
- Input field for user code
- "Sign in as" dropdown

### Approve the Login

1. Copy the user code from window 1 (e.g., `ABCD-EFGH`)
2. Paste it into window 2's input field
3. Click "Approve"
4. Window 1 automatically shows success and redirects to `/dashboard`

## Verifying Success

### Browser Side
✅ QR code appeared
✅ Status changed to "scanned" → "approved" → "logged in"
✅ Redirected to `/dashboard`
✅ Can see session info

### Mobile Side
✅ Code was accepted
✅ Requester info displayed (browser, IP, location)
✅ Approve button showed success message

### Server Side
✅ Check logs for challenge creation
✅ Verify token issuance via `http://api.localhost:3002/health`

## Troubleshooting

### "Connection refused" to Redis/Postgres

```bash
# Check if containers are running
docker-compose ps

# View logs
docker-compose logs redis
docker-compose logs postgres

# Restart
docker-compose restart
```

### QR code not showing

1. Check browser console for errors (F12)
2. Verify `NEXT_PUBLIC_API_URL` matches your setup
3. Check server is running: `curl http://api.localhost:3002/health`

### CORS errors

Make sure the server is running with proper CORS headers:

```bash
# Kill any running instance
pkill -f "node dist/index.js"

# Start fresh
npm run dev
```

### Mobile app can't reach API

Verify in browser console:
```js
fetch('http://api.localhost:3002/health').then(r => r.json()).then(console.log)
```

Should return `{ status: 'ok', timestamp: '...' }`

## Commands Reference

```bash
# Start all services
npm run dev

# Build all apps
npm run build

# Lint all apps
npm run lint

# Start infrastructure
docker-compose up -d

# Stop infrastructure
docker-compose down

# View logs
docker-compose logs -f

# Build a specific app
cd apps/web && npm run build
cd apps/mobile && npm run build
cd apps/server && npm run build
```

## Next Steps

After successful login:

1. **Open another browser tab** → you're already logged in (session is persistent)
2. **Try the deny flow** → refresh and click "Deny" in mobile simulator
3. **Check the database** → query Redis or PostgreSQL for stored challenges
4. **Read the source code** → understand how `@qr-device-flow/*` packages integrate

## Production Deployment

When ready to deploy:

1. **Use HTTPS everywhere** — the library refuses HTTP except localhost
2. **Set strong secrets** — `NEXTAUTH_SECRET`, `JWT_SECRET`
3. **Use real auth provider** — implement proper `issueSession()` callback
4. **Add rate limiting** — on `POST /device/code` endpoint
5. **Configure CORS properly** — don't use wildcard origins
6. **Enable logging** — for debugging in production
7. **Setup health checks** — Kubernetes, load balancers need `/health` endpoint

See main `README.md` for more details.
