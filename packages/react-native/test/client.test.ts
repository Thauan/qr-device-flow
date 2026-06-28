import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DeviceFlowMobileClient,
  DeviceFlowClientError,
} from "../src/client.js";
import type { DeviceFlowMobileConfig } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENDPOINT = "https://auth.example.com/device";
const AUTH_TOKEN = "test-jwt-token-abc123";
const USER_CODE = "ABCD-EFGH";

function makeConfig(
  overrides?: Partial<DeviceFlowMobileConfig>,
): DeviceFlowMobileConfig {
  return {
    endpoint: ENDPOINT,
    getAuthToken: () => AUTH_TOKEN,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DeviceFlowMobileClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---- fetchChallengeDetails ------------------------------------------------

  describe("fetchChallengeDetails", () => {
    it("calls POST /scan with user_code and returns parsed challenge details", async () => {
      const serverPayload = {
        requester_info: {
          userAgent: "Mozilla/5.0",
          ip: "203.0.113.42",
          approxLocation: "Salvador, BR",
        },
        expires_at: 1700000000000,
      };

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        jsonResponse(serverPayload),
      );

      const client = new DeviceFlowMobileClient(makeConfig());
      const details = await client.fetchChallengeDetails(USER_CODE);

      // Verify request
      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/scan`);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({
        user_code: USER_CODE,
      });

      // Verify response mapping
      expect(details).toEqual({
        userCode: USER_CODE,
        requesterInfo: serverPayload.requester_info,
        expiresAt: serverPayload.expires_at,
      });
    });

    it("sends Authorization Bearer header", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        jsonResponse({ requester_info: {}, expires_at: 1700000000000 }),
      );

      const client = new DeviceFlowMobileClient(makeConfig());
      await client.fetchChallengeDetails(USER_CODE);

      const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      const headers = init?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe(`Bearer ${AUTH_TOKEN}`);
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("supports async getAuthToken", async () => {
      const asyncToken = "async-token-xyz";
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        jsonResponse({ requester_info: {}, expires_at: 1700000000000 }),
      );

      const client = new DeviceFlowMobileClient(
        makeConfig({ getAuthToken: async () => asyncToken }),
      );
      await client.fetchChallengeDetails(USER_CODE);

      const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      const headers = init?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe(`Bearer ${asyncToken}`);
    });
  });

  // ---- approve --------------------------------------------------------------

  describe("approve", () => {
    it("calls POST /approve with user_code and auth header", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({}));

      const client = new DeviceFlowMobileClient(makeConfig());
      await client.approve(USER_CODE);

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/approve`);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({
        user_code: USER_CODE,
      });

      const headers = init?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe(`Bearer ${AUTH_TOKEN}`);
    });

    it("resolves void on success", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({}));

      const client = new DeviceFlowMobileClient(makeConfig());
      const result = await client.approve(USER_CODE);
      expect(result).toBeUndefined();
    });
  });

  // ---- deny -----------------------------------------------------------------

  describe("deny", () => {
    it("calls POST /deny with user_code and auth header", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({}));

      const client = new DeviceFlowMobileClient(makeConfig());
      await client.deny(USER_CODE);

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toBe(`${ENDPOINT}/deny`);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({
        user_code: USER_CODE,
      });

      const headers = init?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe(`Bearer ${AUTH_TOKEN}`);
    });
  });

  // ---- error handling -------------------------------------------------------

  describe("error handling", () => {
    it("throws DeviceFlowClientError on server error with JSON error body", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        jsonResponse({ error: "invalid_user_code" }, 400),
      );

      const client = new DeviceFlowMobileClient(makeConfig());

      await expect(client.fetchChallengeDetails(USER_CODE)).rejects.toThrow(
        DeviceFlowClientError,
      );

      try {
        vi.mocked(globalThis.fetch).mockResolvedValueOnce(
          jsonResponse({ error: "expired_token" }, 410),
        );
        await client.fetchChallengeDetails(USER_CODE);
      } catch (err) {
        expect(err).toBeInstanceOf(DeviceFlowClientError);
        expect((err as DeviceFlowClientError).statusCode).toBe(410);
        expect((err as DeviceFlowClientError).message).toContain(
          "expired_token",
        );
      }
    });

    it("throws DeviceFlowClientError on server error with non-JSON body", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("Internal Server Error", {
          status: 500,
          statusText: "Internal Server Error",
        }),
      );

      const client = new DeviceFlowMobileClient(makeConfig());

      await expect(client.approve(USER_CODE)).rejects.toThrow(
        DeviceFlowClientError,
      );
    });

    it("throws DeviceFlowClientError with statusCode 0 on network failure", async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(
        new TypeError("Failed to fetch"),
      );

      const client = new DeviceFlowMobileClient(makeConfig());

      try {
        await client.deny(USER_CODE);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(DeviceFlowClientError);
        expect((err as DeviceFlowClientError).statusCode).toBe(0);
        expect((err as DeviceFlowClientError).message).toContain(
          "Network error",
        );
        expect((err as DeviceFlowClientError).message).toContain(
          "Failed to fetch",
        );
      }
    });

    it("includes the endpoint path in error messages", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        jsonResponse({ error: "unauthorized" }, 401),
      );

      const client = new DeviceFlowMobileClient(makeConfig());

      try {
        await client.approve(USER_CODE);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as DeviceFlowClientError).message).toContain("/approve");
        expect((err as DeviceFlowClientError).statusCode).toBe(401);
      }
    });
  });

  // ---- endpoint normalization -----------------------------------------------

  describe("endpoint normalization", () => {
    it("strips trailing slashes from endpoint", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({}));

      const client = new DeviceFlowMobileClient(
        makeConfig({ endpoint: "https://auth.example.com/device///" }),
      );
      await client.approve(USER_CODE);

      const [url] = vi.mocked(globalThis.fetch).mock.calls[0]!;
      expect(url).toBe("https://auth.example.com/device/approve");
    });
  });
});
