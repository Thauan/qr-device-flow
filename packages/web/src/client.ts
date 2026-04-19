import type { ChallengeStatus, DeviceCodeResponse } from "@qr-device-flow/core";
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

const TERMINAL_STATES: ReadonlySet<ChallengeStatus> = new Set([
  "approved",
  "approved-consumed",
  "denied",
  "expired",
]);

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
    this.transport?.disconnect();
    this.transport = null;
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

    return (await res.json()) as DeviceCodeResponse;
  }

  private startMonitoring(challenge: DeviceCodeResponse): void {
    this.currentDeviceCode = challenge.device_code;

    // Disconnect any existing transport before creating a new one
    this.transport?.disconnect();

    this.transport = this.createTransport();

    this.transport.onStatus((status: ChallengeStatus) => {
      if (this.destroyed) return;

      this.options.onStateChange?.(status);

      if (status === "approved") {
        void this.consumeChallenge();
      } else if (status === "expired" && this.options.autoRegenerate) {
        void this.regenerate();
      } else if (status === "denied") {
        this.options.onError?.(new Error("Authorization denied by user"));
      }
    });

    this.transport.onError?.((error: Error) => {
      if (this.destroyed) return;
      this.options.onError?.(error);
    });

    this.transport.connect(challenge.device_code, challenge.interval);
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

  private async consumeChallenge(): Promise<void> {
    if (!this.currentDeviceCode || this.destroyed) return;

    try {
      const res = await fetch(`${this.options.endpoint}/consume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: this.currentDeviceCode }),
      });

      if (!res.ok) {
        throw new Error(`Failed to consume challenge: HTTP ${res.status}`);
      }

      const body = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      this.options.onApproved?.({
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresIn: body.expires_in,
      });
    } catch (err) {
      this.options.onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  private async regenerate(): Promise<void> {
    if (this.destroyed) return;

    this.transport?.disconnect();
    this.transport = null;
    this.currentDeviceCode = null;

    try {
      if (this.containerEl) {
        // Re-render with a new challenge in DOM mode
        await this.start({ container: this.containerEl });
      } else {
        // In headless mode, just create a new challenge and monitor
        const challenge = await this.createChallenge();
        if (!this.destroyed) {
          this.startMonitoring(challenge);
        }
      }
    } catch (err) {
      this.options.onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}
