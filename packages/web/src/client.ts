import type { ChallengeStatus, DeviceCodeResponse } from "@qr-device-flow/core";
import { TERMINAL_STATES } from "@qr-device-flow/core";
import {
  isDeviceCodeResponse,
  isSessionResponsePayload,
} from "./types/validators.js";
import { generateQRDataUrl, generateQRSvg } from "./qr.js";
import { PollingTransport } from "./transports/polling.js";
import { SSETransport } from "./transports/sse.js";
import type { Transport } from "./transports/types.js";
import { WebSocketTransport } from "./transports/websocket.js";
import type {
  ApprovedSession,
  HeadlessResult,
  QRDeviceFlowOptions,
} from "./types.js";

/**
 * Browser client for QR-based device authentication (RFC 8628).
 *
 * Renders a QR code, monitors the server for status changes via the
 * configured transport, and automatically consumes the session on
 * approval.
 *
 * @example
 * ```ts
 * const flow = new QRDeviceFlow({
 *   endpoint: "https://api.example.com/device",
 *   onApproved: (session) => console.log("Logged in!", session),
 * });
 * flow.start({ container: "#qr-box" });
 * ```
 */
export class QRDeviceFlow {
  private readonly options: QRDeviceFlowOptions;
  private transport: Transport | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private currentDeviceCode: string | null = null;
  private destroyed = false;
  private containerEl: HTMLElement | null = null;

  constructor(options: QRDeviceFlowOptions) {
    this.options = {
      transport: "polling",
      autoRegenerate: false,
      qrSize: 256,
      ...options,
    };
  }

  /**
   * DOM mode: creates a challenge, renders the QR code into the
   * specified container element, and starts monitoring for status
   * changes.
   *
   * @param opts.container  CSS selector or `HTMLElement` to render into.
   */
  async start(opts: { container: string | HTMLElement }): Promise<void> {
    if (this.destroyed) return;

    const container =
      typeof opts.container === "string"
        ? document.querySelector<HTMLElement>(opts.container)
        : opts.container;

    if (!container) {
      throw new Error(
        `Container element not found: ${String(opts.container)}`,
      );
    }

    this.containerEl = container;

    const challenge = await this.createChallenge();
    const svg = await generateQRSvg(
      challenge.verification_uri_complete,
      this.options.qrSize,
    );

    if (this.destroyed) return;

    container.innerHTML = svg;
    this.startMonitoring(challenge);
  }

  /**
   * Headless mode: creates a challenge and returns the QR data URL,
   * user code, device code, and expiration without touching the DOM.
   *
   * The caller is responsible for rendering the QR code.
   */
  async startHeadless(): Promise<HeadlessResult> {
    const challenge = await this.createChallenge();
    const qrDataUrl = await generateQRDataUrl(
      challenge.verification_uri_complete,
      this.options.qrSize,
    );

    if (!this.destroyed) {
      this.startMonitoring(challenge);
    }

    return {
      qrDataUrl,
      userCode: challenge.user_code,
      deviceCode: challenge.device_code,
      expiresAt: Date.now() + challenge.expires_in * 1000,
    };
  }

  /**
   * Tear down the client: disconnect transport, clean up DOM, and
   * prevent further operations.
   */
  destroy(): void {
    this.destroyed = true;
    this.stopMonitoring();
    this.currentDeviceCode = null;
    if (this.containerEl) {
      this.containerEl.innerHTML = "";
      this.containerEl = null;
    }
  }

  // ── Private ──────────────────────────────────────────────────────

  private async createChallenge(): Promise<DeviceCodeResponse> {
    const res = await fetch(`${this.options.endpoint}/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      throw new Error(`Failed to create challenge: HTTP ${res.status}`);
    }

    const body = await res.json();
    if (!isDeviceCodeResponse(body)) {
      throw new Error(
        "Invalid device code response: missing or invalid required fields",
      );
    }

    return body;
  }

  private startMonitoring(challenge: DeviceCodeResponse): void {
    this.stopMonitoring();

    const transport = this.createTransport();
    this.transport = transport;
    this.currentDeviceCode = challenge.device_code;

    // The client enforces the TTL locally too, so the UI never gets stuck
    // on "pending" when the server stops reporting the challenge.
    this.expiryTimer = setTimeout(() => {
      this.handleStatus(transport, "expired");
    }, challenge.expires_in * 1000);

    transport.onStatus((status: ChallengeStatus) => {
      this.handleStatus(transport, status);
    });

    transport.onError?.((error: Error) => {
      if (this.isCurrent(transport)) {
        this.options.onError?.(error);
      }
    });

    transport.connect(challenge.device_code, challenge.interval);
  }

  /**
   * Stops monitoring the current challenge. Callbacks from the stopped
   * transport are ignored afterwards, so late responses can't act on a
   * newer challenge.
   */
  private stopMonitoring(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    this.transport?.disconnect();
    this.transport = null;
  }

  private isCurrent(transport: Transport): boolean {
    return !this.destroyed && this.transport === transport;
  }

  private handleStatus(transport: Transport, status: ChallengeStatus): void {
    if (!this.isCurrent(transport)) return;

    this.options.onStateChange?.(status);

    switch (status) {
      case "approved": {
        // Stop monitoring before consuming so a late status update can't
        // trigger a second consume for the same challenge.
        const deviceCode = this.currentDeviceCode;
        this.stopMonitoring();
        if (deviceCode) {
          void this.consumeChallenge(deviceCode);
        }
        break;
      }
      case "expired":
        this.stopMonitoring();
        if (this.options.autoRegenerate) {
          void this.regenerate();
        }
        break;
      case "denied":
        this.stopMonitoring();
        this.options.onError?.(new Error("Authorization denied by user"));
        break;
      default:
        if (TERMINAL_STATES.has(status)) {
          this.stopMonitoring();
        }
    }
  }

  private createTransport(): Transport {
    const { endpoint, transport: type } = this.options;
    switch (type) {
      case "sse":
        return new SSETransport(endpoint);
      case "websocket":
        return new WebSocketTransport(endpoint);
      case "polling":
      default:
        return new PollingTransport(endpoint);
    }
  }

  private async consumeChallenge(deviceCode: string): Promise<void> {
    if (this.destroyed) return;

    try {
      const res = await fetch(`${this.options.endpoint}/consume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: deviceCode }),
      });

      if (!res.ok) {
        throw new Error(`Failed to consume challenge: HTTP ${res.status}`);
      }

      const body = await res.json();
      if (!isSessionResponsePayload(body)) {
        throw new Error(
          "Invalid session response: missing or invalid access_token",
        );
      }

      if (this.destroyed) return;

      this.options.onApproved?.({
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresIn: body.expires_in,
      });
    } catch (err) {
      if (this.destroyed) return;
      this.options.onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  private async regenerate(): Promise<void> {
    if (this.destroyed) return;

    this.stopMonitoring();
    this.currentDeviceCode = null;

    try {
      if (this.containerEl) {
        // Re-render with a new challenge in DOM mode
        await this.start({ container: this.containerEl });
      } else {
        // Headless mode: the caller owns the QR, so hand it the new one.
        // startHeadless() renders the new QR and starts monitoring it.
        const result = await this.startHeadless();
        if (!this.destroyed) {
          this.options.onRegenerate?.(result);
        }
      }
    } catch (err) {
      this.options.onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}
