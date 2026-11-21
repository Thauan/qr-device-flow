/**
 * One-call route setup for Express (or any router with the same shape).
 *
 * @example
 * ```ts
 * import express from "express";
 * import { mountDeviceFlowRoutes } from "@qr-device-flow/server/express";
 *
 * const app = express();
 * app.use(express.json());
 *
 * mountDeviceFlowRoutes(app, {
 *   server,
 *   authenticate: (req) => verifyBearerToken(req.headers.authorization), // userId | null
 * });
 * ```
 *
 * Registers, under `basePath` (default `/device`):
 *
 * | Method | Path      | Caller        |
 * |--------|-----------|---------------|
 * | POST   | `/code`    | browser       |
 * | GET    | `/status`  | browser       |
 * | GET    | `/events`  | browser (SSE) |
 * | POST   | `/consume` | browser       |
 * | POST   | `/scan`    | mobile (auth) |
 * | POST   | `/approve` | mobile (auth) |
 * | POST   | `/deny`    | mobile (auth) |
 */

import { ProtocolError } from "@qr-device-flow/core";
import { assertValidDeviceCode } from "@qr-device-flow/core/server";
import type { DeviceFlowServer } from "./server.js";
import { effectiveStatus, streamChallengeStatus } from "./status-stream.js";

// ── Minimal structural types (no `express` dependency) ─────────────

export interface DeviceFlowRequest {
  readonly body?: unknown;
  readonly query: Record<string, unknown>;
  readonly headers: Record<string, unknown>;
  readonly ip?: string;
}

export interface DeviceFlowResponse {
  status(code: number): DeviceFlowResponse;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): unknown;
  flushHeaders?(): unknown;
  write(chunk: string): unknown;
  end(): unknown;
  on(event: "close", listener: () => void): unknown;
}

export type DeviceFlowHandler = (
  req: DeviceFlowRequest,
  res: DeviceFlowResponse,
) => unknown;

export interface DeviceFlowRouter {
  get(path: string, handler: DeviceFlowHandler): unknown;
  post(path: string, handler: DeviceFlowHandler): unknown;
}

export interface MountDeviceFlowOptions {
  server: DeviceFlowServer;

  /**
   * Resolves the authenticated mobile user for a request, or `null`.
   * Used by `/scan`, `/approve` and `/deny`. The approving user ID always
   * comes from here, never from the request body.
   */
  authenticate: (req: DeviceFlowRequest) => string | null | Promise<string | null>;

  /** Route prefix. Defaults to `"/device"`. */
  basePath?: string;

  /** Storage check interval for the SSE stream, in ms. Defaults to 1000. */
  ssePollIntervalMs?: number;

  /**
   * Optional QR renderer. When provided, `/code` also returns `qr_svg`.
   * Browsers using `@qr-device-flow/web` don't need it.
   */
  renderQr?: (data: string) => Promise<string>;
}

// ── Errors ─────────────────────────────────────────────────────────

class BadRequestError extends Error {
  readonly code = "invalid_request";
}

class UnauthorizedError extends Error {
  readonly code = "unauthorized";
}

function sendError(res: DeviceFlowResponse, err: unknown): void {
  if (err instanceof UnauthorizedError) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }
  if (err instanceof BadRequestError) {
    res.status(400).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof ProtocolError) {
    res.status(400).json({ error: err.message, code: err.code });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error", code: "server_error" });
}

// ── Helpers ────────────────────────────────────────────────────────

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequestError(`Missing ${name}`);
  }
  return value;
}

function bodyField(req: DeviceFlowRequest, name: string): unknown {
  const body = req.body;
  if (typeof body === "object" && body !== null) {
    return (body as Record<string, unknown>)[name];
  }
  return undefined;
}

async function requireUser(
  req: DeviceFlowRequest,
  authenticate: MountDeviceFlowOptions["authenticate"],
): Promise<string> {
  const userId = await authenticate(req);
  if (!userId) throw new UnauthorizedError("Unauthorized");
  return userId;
}

function header(req: DeviceFlowRequest, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}

// ── Mount ──────────────────────────────────────────────────────────

export function mountDeviceFlowRoutes(
  app: DeviceFlowRouter,
  opts: MountDeviceFlowOptions,
): void {
  const { server, authenticate } = opts;
  const base = (opts.basePath ?? "/device").replace(/\/+$/, "");

  app.post(`${base}/code`, async (req, res) => {
    try {
      const requesterInfo: Record<string, string> = {};
      const userAgent = header(req, "user-agent");
      if (userAgent) requesterInfo.userAgent = userAgent;
      if (req.ip) requesterInfo.ip = req.ip;

      const challenge = await server.createChallenge(requesterInfo);
      const body: Record<string, unknown> = { ...challenge };
      if (opts.renderQr) {
        body.qr_svg = await opts.renderQr(challenge.verification_uri_complete);
      }
      res.json(body);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get(`${base}/status`, async (req, res) => {
    try {
      const deviceCode = requireString(req.query.device_code, "device_code");
      const challenge = await server.getStatus(deviceCode);
      res.json({ status: effectiveStatus(challenge, Date.now()) });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get(`${base}/events`, (req, res) => {
    let deviceCode: string;
    try {
      deviceCode = requireString(req.query.device_code, "device_code");
      // Only malformed codes are rejected here. Unknown or expired codes get
      // an `expired` event on the stream, which is what the browser expects.
      assertValidDeviceCode(deviceCode);
    } catch (err) {
      sendError(res, err);
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
    res.flushHeaders?.();

    streamChallengeStatus(
      server,
      deviceCode,
      {
        write: (chunk) => {
          res.write(chunk);
        },
        end: () => {
          res.end();
        },
        // Listen on the response, not the request: for a GET without a body,
        // the request emits "close" as soon as it is read.
        onClose: (listener) => {
          res.on("close", listener);
        },
      },
      { pollIntervalMs: opts.ssePollIntervalMs },
    );
  });

  app.post(`${base}/consume`, async (req, res) => {
    try {
      const deviceCode = requireString(bodyField(req, "device_code"), "device_code");
      const session = await server.consume(deviceCode);
      res.json({
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
        expires_in: session.expiresIn,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post(`${base}/scan`, async (req, res) => {
    try {
      await requireUser(req, authenticate);
      const userCode = requireString(bodyField(req, "user_code"), "user_code");
      const challenge = await server.markScanned(userCode);
      res.json({
        requester_info: challenge.requesterInfo,
        expires_at: challenge.expiresAt,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post(`${base}/approve`, async (req, res) => {
    try {
      const userId = await requireUser(req, authenticate);
      const userCode = requireString(bodyField(req, "user_code"), "user_code");
      await server.approve(userCode, userId);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post(`${base}/deny`, async (req, res) => {
    try {
      await requireUser(req, authenticate);
      const userCode = requireString(bodyField(req, "user_code"), "user_code");
      await server.deny(userCode);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });
}
