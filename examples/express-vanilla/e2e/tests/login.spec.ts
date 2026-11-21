import { test, expect } from "@playwright/test";
import { openPhone, reviewOnPhone, startWebLogin, type Transport } from "../helpers";

// The "web" page is the browser that wants to log in.
// The "phone" is a separate browser context. It runs the real
// DeviceFlowMobileClient (public/mobile-app.js) and opens the URL that the QR encodes.

const TRANSPORTS: Transport[] = ["sse", "polling"];

test.describe("health", () => {
  test("server reports healthy", async ({ request }) => {
    const res = await request.get("/healthz");
    expect(res.ok()).toBe(true);
    expect(await res.json()).toEqual({ ok: true });
  });
});

for (const transport of TRANSPORTS) {
  test.describe(`transport: ${transport}`, () => {
    test("the phone scans the QR, reviews, and approves; the browser is logged in", async ({ page, browser, baseURL }) => {
      const login = await startWebLogin(page, transport);
      const { context, phone } = await openPhone(browser, baseURL, login.phonePath, "alice");

      await reviewOnPhone(phone);
      await phone.getByTestId("approve-btn").click();
      await expect(phone.getByTestId("feedback")).toContainText("Login approved");

      await expect(page.getByTestId("status")).toHaveAttribute("data-state", "logged-in");
      await expect(page.getByTestId("status")).toHaveText("Logged in successfully!");
      await expect(page.getByTestId("session")).toContainText("demo-token-alice");

      await context.close();
    });

    test("the phone denies the login and the browser shows it", async ({ page, browser, baseURL }) => {
      const login = await startWebLogin(page, transport);
      const { context, phone } = await openPhone(browser, baseURL, login.phonePath, "alice");

      await reviewOnPhone(phone);
      await phone.getByTestId("deny-btn").click();
      await expect(phone.getByTestId("feedback")).toContainText("Login denied");

      await expect(page.getByTestId("status")).toHaveAttribute("data-state", "denied");
      await expect(page.getByTestId("retry")).toBeVisible();
      await expect(page.getByTestId("session")).toBeHidden();

      await context.close();
    });

    test("reviewing on the phone shows the browser as scanned, with the requester's details", async ({ page, browser, baseURL }) => {
      const login = await startWebLogin(page, transport);
      const { context, phone } = await openPhone(browser, baseURL, login.phonePath, "alice");

      await reviewOnPhone(phone);

      await expect(page.getByTestId("status")).toHaveAttribute("data-state", "scanned");
      await expect(phone.getByTestId("requester-agent")).not.toHaveText(/^—$|^unknown browser$/);
      await expect(phone.getByTestId("expires-in")).toHaveText(/^\d+s$/);

      await context.close();
    });

    test("nothing can be approved before the request is reviewed", async ({ page, browser, baseURL }) => {
      const login = await startWebLogin(page, transport);
      const { context, phone } = await openPhone(browser, baseURL, login.phonePath, "alice");

      await expect(phone.getByTestId("approve-btn")).toBeHidden();
      await expect(phone.getByTestId("review-btn")).toBeVisible();
      await expect(page.getByTestId("status")).toHaveAttribute("data-state", "pending");

      await context.close();
    });

    test("retry starts a new login with a different code", async ({ page, browser, baseURL }) => {
      const first = await startWebLogin(page, transport);
      const { context, phone } = await openPhone(browser, baseURL, first.phonePath, "alice");
      await reviewOnPhone(phone);
      await phone.getByTestId("deny-btn").click();
      await expect(page.getByTestId("status")).toHaveAttribute("data-state", "denied");

      await page.getByTestId("retry").click();
      await expect(page.getByTestId("status")).toHaveAttribute("data-state", "pending");
      await expect(page.getByTestId("user-code")).not.toHaveText(first.userCode);

      await context.close();
    });
  });
}

test("the phone reports an unknown login code as an error", async ({ browser, baseURL }) => {
  const { context, phone } = await openPhone(browser, baseURL, "/mobile.html?user_code=ZZZZ-ZZZZ", "alice");
  await phone.getByTestId("review-btn").click();
  await expect(phone.getByTestId("feedback")).toContainText("invalid_user_code");
  await context.close();
});

test("an unanswered login expires and says so", async ({ page }) => {
  // The server runs with TTL_SECONDS=30 (see playwright.config.ts).
  await startWebLogin(page, "sse");
  await expect(page.getByTestId("status")).toHaveAttribute("data-state", "expired", { timeout: 45_000 });
  await expect(page.getByTestId("retry")).toBeVisible();
});
