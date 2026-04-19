import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import QRCode from "qrcode";
import { DeviceFlowServer } from "@qr-device-flow/server";
import { MemoryStorage } from "@qr-device-flow/server/storage/memory";
import { ProtocolError } from "@qr-device-flow/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const storage = new MemoryStorage();
const server = new DeviceFlowServer({
  storage,
  verificationUri: "http://localhost:3000/mobile.html",
  issueSession: async ({ userId }) => ({
    accessToken: `demo-token-${userId}-${Date.now()}`,
    refreshToken: `demo-refresh-${userId}`,
    expiresIn: 3600,
  }),
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


// Device code creation
app.post("/device/code", async (req, res) => {
  try {
    const result = await server.createChallenge(req.body?.requester_info ?? {
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    });
    const qrSvg = await QRCode.toString(result.verification_uri_complete, {
      type: "svg",
      margin: 0,
      color: { dark: "#1a1b23", light: "#ffffff" },
    });
    res.json({ ...result, qr_svg: qrSvg });
  } catch (err) {
    handleError(res, err);
  }
});

// Status polling
app.get("/device/status", async (req, res) => {
  try {
    const challenge = await server.getStatus(req.query.device_code as string);
    res.json({ status: challenge.status });
  } catch (err) {
    handleError(res, err);
  }
});

// Consume (browser claims session)
app.post("/device/consume", async (req, res) => {
  try {
    const session = await server.consume(req.body.device_code);
    res.json({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      expires_in: session.expiresIn,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// Scan (mobile notifies)
app.post("/device/scan", async (req, res) => {
  try {
    await server.markScanned(req.body.user_code);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// Approve
app.post("/device/approve", async (req, res) => {
  try {
    await server.approve(req.body.user_code, req.body.user_id);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// Deny
app.post("/device/deny", async (req, res) => {
  try {
    await server.deny(req.body.user_code);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

function handleError(res: express.Response, err: unknown) {
  if (err instanceof ProtocolError) {
    res.status(400).json({ error: err.message, code: err.code });
  } else {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`QR Device Flow demo running at http://localhost:${PORT}`);
  console.log(`  Web login:        http://localhost:${PORT}/`);
  console.log(`  Mobile simulator: http://localhost:${PORT}/mobile.html`);
});
