import { test, expect, request as apiRequest } from "@playwright/test";
import { API_BASE, approveOnPhone, openPhone, reviewOnPhone, startWebLogin, type Transport } from "../helpers";

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
      // The consent screen names the site that asked (the login page's origin).
      await expect(phone.getByTestId("requester-origin")).toContainText("localhost");
      await approveOnPhone(phone, login.verificationNumber);
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

test.describe("browser binding and number matching", () => {
  test("a wrong number is rejected on the phone, and the login stays scanned", async ({ page, browser, baseURL }) => {
    const login = await startWebLogin(page, "sse");
    const wrong = login.verificationNumber === "00" ? "01" : "00";
    const { context, phone } = await openPhone(browser, baseURL, login.phonePath, "alice");

    await reviewOnPhone(phone);
    await approveOnPhone(phone, wrong);
    await expect(phone.getByTestId("feedback")).toContainText("invalid_verification_number");
    await expect(page.getByTestId("status")).toHaveAttribute("data-state", "scanned");

    await context.close();
  });

  test("three wrong numbers deny the login, so the right number comes too late", async ({ page, browser, baseURL }) => {
    const login = await startWebLogin(page, "sse");
    const wrong = login.verificationNumber === "00" ? "01" : "00";
    const { context, phone } = await openPhone(browser, baseURL, login.phonePath, "alice");
    await reviewOnPhone(phone);

    for (let attempt = 0; attempt < 3; attempt++) {
      await approveOnPhone(phone, wrong);
      await expect(phone.getByTestId("feedback")).toContainText("invalid_verification_number");
    }
    await expect(page.getByTestId("status")).toHaveAttribute("data-state", "denied");

    await approveOnPhone(phone, login.verificationNumber);
    await expect(phone.getByTestId("feedback")).toContainText("already in terminal state: denied");

    await context.close();
  });

  test("the binding cookie is HttpOnly, SameSite=Strict and scoped to the API path", async ({ page }) => {
    await startWebLogin(page, "sse");
    const cookie = (await page.context().cookies()).find((c) => c.name === "qrdf_bind");

    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe("Strict");
    expect(cookie!.path).toBe("/device");
  });

  test("a client without the binding cookie can't read a login's status", async () => {
    const creator = await apiRequest.newContext({ baseURL: API_BASE });
    const challenge = await (await creator.post("/device/code")).json();
    await creator.dispose();

    const stranger = await apiRequest.newContext({ baseURL: API_BASE });
    const status = await stranger.get(`/device/status?device_code=${challenge.device_code}`);
    expect(status.status()).toBe(400);
    expect(await status.json()).toMatchObject({ code: "invalid_binding" });
    await stranger.dispose();
  });
});

test.describe("approval needs a deliberate hold", () => {
  test("a quick tap on approve does not approve the login (stays scanned)", async ({ page, browser, baseURL }) => {
    const login = await startWebLogin(page, "sse");
    const { context, phone } = await openPhone(browser, baseURL, login.phonePath, "alice");
    await reviewOnPhone(phone);
    await phone.getByTestId("number-input").fill(login.verificationNumber);

    await phone.getByTestId("approve-btn").click(); // a tap, not a hold
    await phone.waitForTimeout(1500);

    await expect(phone.getByTestId("feedback")).toBeHidden();
    await expect(page.getByTestId("status")).toHaveAttribute("data-state", "scanned");
    await context.close();
  });
});
