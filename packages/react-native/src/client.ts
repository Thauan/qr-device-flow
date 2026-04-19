import type { RequesterInfo } from "@qr-device-flow/core";
import type { ChallengeDetails, DeviceFlowMobileConfig } from "./types.js";

/**
 * Error thrown when the device flow server returns a non-OK response.
 */
export class DeviceFlowClientError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "DeviceFlowClientError";
    this.statusCode = statusCode;
  }
}

/**
 * Mobile client for the QR-based device authentication flow (RFC 8628).
 *
 * This client communicates with the device flow server to:
 * 1. Report a scanned QR code and fetch challenge details for the consent screen
 * 2. Approve or deny the login request after user review
 *
 * SECURITY: This client intentionally provides NO auto-approve capability.
 * Every approval must pass through a consent screen showing requester info.
 */
export class DeviceFlowMobileClient {
  readonly #endpoint: string;
  readonly #getAuthToken: () => string | Promise<string>;

  constructor(config: DeviceFlowMobileConfig) {
    // Strip trailing slash for consistent URL construction
    this.#endpoint = config.endpoint.replace(/\/+$/, "");
    this.#getAuthToken = config.getAuthToken;
  }

  /**
   * Notifies the server that a QR code was scanned, transitioning the
   * challenge to "scanned" status. Returns details for the consent screen.
   *
   * The caller MUST display `requesterInfo` to the user before calling
   * `approve()` or `deny()`.
   */
  async fetchChallengeDetails(userCode: string): Promise<ChallengeDetails> {
    const response = await this.#post("/scan", { user_code: userCode });

    const body = (await response.json()) as {
      requester_info: RequesterInfo;
      expires_at: number;
    };

    return {
      userCode,
      requesterInfo: body.requester_info,
      expiresAt: body.expires_at,
    };
  }

  /**
   * Approves the challenge after the user has reviewed the consent screen.
   * The server identifies the approving user via the Bearer token.
   */
  async approve(userCode: string): Promise<void> {
    await this.#post("/approve", { user_code: userCode });
  }

  /**
   * Denies the challenge. The requesting browser will be notified that
   * the login was rejected.
   */
  async deny(userCode: string): Promise<void> {
    await this.#post("/deny", { user_code: userCode });
  }

  /**
   * Internal helper: POST to a server endpoint with auth and JSON body.
   */
  async #post(path: string, body: Record<string, unknown>): Promise<Response> {
    const token = await this.#getAuthToken();

    let response: Response;
    try {
      response = await fetch(`${this.#endpoint}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new DeviceFlowClientError(
        0,
        `Network error calling ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      let detail: string;
      try {
        const errorBody = (await response.json()) as { error?: string };
        detail = errorBody.error ?? response.statusText;
      } catch {
        detail = response.statusText;
      }
      throw new DeviceFlowClientError(
        response.status,
        `Server error ${response.status} on ${path}: ${detail}`,
      );
    }

    return response;
  }
}
