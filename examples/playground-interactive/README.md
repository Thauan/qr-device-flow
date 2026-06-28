# QR Device Flow - Interactive Playground

An **RFC 8628-compliant** interactive demonstration that runs entirely in the browser. No backend, no installation — just open and play.

## What This Shows

- **State machine**: All 6 states (pending, scanned, approved, denied, expired, approved-consumed)
- **QR code generation**: Live SVG rendering of verification URI
- **Polling**: Browser polls for status changes
- **Mobile approval flow**: User code fallback, consent screen, requester info
- **Atomic consumption**: Single-use session tokens with state guarantee
- **Token issuance**: Demo JWT tokens on success

## Quick Start

```bash
cd examples/playground-interactive
npm install
npm run dev
```

Opens at `http://localhost:5173` with hot reload.

## How to Use

### Browser Side (Left Panel)
1. Click "Start QR Login"
2. A QR code appears (+ fallback user code)
3. Browser starts polling every 2 seconds

### Mobile Side (Right Panel)
1. Scan the QR code or paste the user code
2. Requester info appears (browser type, IP, location)
3. Choose **Approve** or **Deny**

### Result
- If approved: Browser receives token, session shows ✅
- If denied: Error state
- If expired: Timeout after 120 seconds

## File Structure

```
src/
├── simulator.ts       # RFC 8628 state machine + in-memory storage
└── components.tsx     # React UI (browser panel + mobile panel)
```

## Key Features

### RFC 8628 Compliance
- State transitions match the standard spec
- User code alphabet (no 0/O/1/I/L ambiguity)
- 120-second default TTL (600s max configurable)
- `compareAndSwap` semantics for single-use

### No Dependencies
- No backend server needed
- All state is in-memory
- Works offline (except QR generation needs qrcode.js)

### Teaching Tool
- Shows the full flow visually
- Debug panel displays state transitions
- Ideal for documentation or blog posts

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Requires ES2020+ support
- QR generation via `qrcode` library

## For Production Use

This playground is **not production-ready**. To integrate into your app:

1. Use `@qr-device-flow/web` (browser client)
2. Use `@qr-device-flow/server` (backend)
3. Implement your own `issueSession()` callback
4. Use Redis or your database for storage

See the parent directory `examples/nextjs-fullstack` for a real-world example.

## RFC 8628 Reference

https://www.rfc-editor.org/rfc/rfc8628
