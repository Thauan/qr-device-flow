import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Two servers take part:
//   - the Express demo (device-flow API, login pages)      → E2E_BASE_URL, port 3100 on the host
//   - the Next.js app (client-side widget, proxies /device) → E2E_NEXT_URL, port 3200 on the host
//
// 1. Host (no Docker): Playwright starts both servers itself (in-memory storage, TTL 30 s).
//      npm run test:e2e
//
// 2. Against running servers (e.g. docker compose): set both URLs.
//      E2E_BASE_URL=http://localhost:3000 E2E_NEXT_URL=http://localhost:3200 npm run test:e2e

const externalApi = process.env.E2E_BASE_URL;
const externalNext = process.env.E2E_NEXT_URL;
const apiPort = Number(process.env.E2E_PORT ?? 3100);
const nextPort = 3200;
const apiURL = externalApi ?? `http://localhost:${apiPort}`;
const nextURL = externalNext ?? `http://localhost:${nextPort}`;

const expressDir = fileURLToPath(new URL("..", import.meta.url));
const nextDir = fileURLToPath(new URL("../../nextjs-element", import.meta.url));

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // Express pages: login page, plain HTML / React / Vue element pages, mobile page.
      name: "express",
      testIgnore: /next\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: apiURL },
    },
    {
      // The Next.js app, which talks to the API through its own /device proxy.
      name: "next",
      testMatch: /next\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: nextURL },
    },
  ],
  webServer: [
    ...(externalApi
      ? []
      : [
          {
            command: "npm start",
            cwd: expressDir,
            url: `${apiURL}/healthz`,
            reuseExistingServer: !process.env.CI,
            // Short TTL so the expiry tests finish in reasonable time.
            env: { PORT: String(apiPort), TTL_SECONDS: "30", TRUST_PROXY: "1" },
            timeout: 90_000,
          },
        ]),
    ...(externalNext
      ? []
      : [
          {
            command: "npm run build && npm start",
            cwd: nextDir,
            url: nextURL,
            reuseExistingServer: !process.env.CI,
            env: { API_URL: apiURL, NEXT_TELEMETRY_DISABLED: "1" },
            timeout: 240_000,
          },
        ]),
  ],
});
