import express from 'express';
import cors from 'cors';
import { DeviceFlowServer } from '@qr-device-flow/server';
import { RedisStorage } from '@qr-device-flow/storage-redis';
import { createClient } from 'redis';
import QRCode from 'qrcode';
import { ProtocolError } from '@qr-device-flow/core';

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());

// Redis client
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', (err) => {
  console.error('Redis error:', err);
  process.exit(1);
});

// Initialize Redis connection
await redisClient.connect();
console.log('✓ Redis connected');

// Storage
const storage = new RedisStorage(redisClient);

// Device Flow Server
const server = new DeviceFlowServer({
  storage,
  verificationUri: 'http://mobile.localhost:3001/connect',
  issueSession: async ({ userId }) => {
    // In production, this would call your auth system to issue real JWTs
    return {
      accessToken: `demo-jwt-${userId}-${Date.now()}`,
      refreshToken: `refresh-${userId}`,
      expiresIn: 3600,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────
// RFC 8628 Endpoints
// ─────────────────────────────────────────────────────────────────────

/**
 * POST /device/code
 * Create a new device authorization challenge
 */
app.post('/device/code', async (req, res) => {
  try {
    const challenge = await server.createChallenge({
      userAgent: req.headers['user-agent'] || 'unknown',
      ip: req.ip || 'unknown',
      approxLocation: 'São Paulo, BR', // Mock for demo
    });

    // Generate QR code SVG
    const qrSvg = await QRCode.toString(challenge.verification_uri_complete, {
      type: 'image/svg+xml',
      margin: 1,
      color: { dark: '#1a1b23', light: '#ffffff' },
      width: 220,
    });

    res.json({
      device_code: challenge.deviceCode,
      user_code: challenge.userCode,
      verification_uri: challenge.verification_uri,
      verification_uri_complete: challenge.verification_uri_complete,
      expires_in: challenge.expiresIn,
      interval: 5,
      qr_svg: qrSvg, // Extra field for demo
    });
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * GET /device/status
 * Poll for status of a challenge
 */
app.get('/device/status', async (req, res) => {
  try {
    const deviceCode = req.query.device_code as string;

    if (!deviceCode) {
      return res.status(400).json({
        error: 'Missing device_code parameter',
        code: 'invalid_request',
      });
    }

    const challenge = await server.getStatus(deviceCode);

    res.json({ status: challenge.status });
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * POST /device/scan
 * Mark a challenge as scanned (optional UX step)
 */
app.post('/device/scan', async (req, res) => {
  try {
    const userCode = req.body.user_code as string;

    if (!userCode) {
      return res.status(400).json({
        error: 'Missing user_code',
        code: 'invalid_request',
      });
    }

    await server.markScanned(userCode);

    res.json({ ok: true });
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * POST /device/approve
 * Approve a challenge (user action on mobile)
 */
app.post('/device/approve', async (req, res) => {
  try {
    const userCode = req.body.user_code as string;
    const userId = req.body.user_id as string; // In production, extract from Bearer token

    if (!userCode) {
      return res.status(400).json({
        error: 'Missing user_code',
        code: 'invalid_request',
      });
    }

    if (!userId) {
      return res.status(401).json({
        error: 'Unauthorized: No user ID',
        code: 'unauthorized',
      });
    }

    await server.approve(userCode, userId);

    res.json({ ok: true });
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * POST /device/deny
 * Deny a challenge
 */
app.post('/device/deny', async (req, res) => {
  try {
    const userCode = req.body.user_code as string;

    if (!userCode) {
      return res.status(400).json({
        error: 'Missing user_code',
        code: 'invalid_request',
      });
    }

    await server.deny(userCode);

    res.json({ ok: true });
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * POST /device/consume
 * Consume a challenge (browser claims the session)
 */
app.post('/device/consume', async (req, res) => {
  try {
    const deviceCode = req.body.device_code as string;

    if (!deviceCode) {
      return res.status(400).json({
        error: 'Missing device_code',
        code: 'invalid_request',
      });
    }

    const session = await server.consume(deviceCode);

    res.json({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      expires_in: session.expiresIn,
    });
  } catch (error) {
    handleError(res, error);
  }
});

// ─────────────────────────────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────────────────────────────
// Error Handler
// ─────────────────────────────────────────────────────────────────────

function handleError(res: express.Response, error: unknown) {
  if (error instanceof ProtocolError) {
    return res.status(400).json({
      error: error.message,
      code: error.code,
    });
  }

  console.error('Unexpected error:', error);
  res.status(500).json({
    error: 'Internal server error',
    code: 'server_error',
  });
}

// ─────────────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n✓ QR Device Flow server running on http://api.localhost:${PORT}`);
  console.log(`  POST   /device/code      - Create challenge`);
  console.log(`  GET    /device/status    - Poll status`);
  console.log(`  POST   /device/scan      - Mark scanned`);
  console.log(`  POST   /device/approve   - Approve challenge`);
  console.log(`  POST   /device/deny      - Deny challenge`);
  console.log(`  POST   /device/consume   - Consume session`);
  console.log(`  GET    /health           - Health check\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n✓ Shutting down...');
  await redisClient.disconnect();
  process.exit(0);
});
