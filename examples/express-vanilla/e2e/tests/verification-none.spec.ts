import { test, expect } from "@playwright/test";
import { holdToApprove, openPhone, phonePathFromQr, reviewOnPhone } from "../helpers";

// A second server runs with VERIFICATION=none (see playwright.config.ts).
// There is no number on the login page, and the phone approves on consent alone.

test("with verification off, the login page shows no number", async ({ page }) => {
  await page.goto("/?transport=sse");
  await expect(page.getByTestId("user-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await expect(page.getByTestId("verification-number")).toBeHidden();
});

test("with verification off, the phone approves after reviewing, without a number", async ({ page, browser, baseURL }) => {
  await page.goto("/?transport=sse");
  const userCode = (await page.getByTestId("user-code").textContent())!.trim();
  const phonePath = await phonePathFromQr(page.getByTestId("qr"), userCode);

  const { context, phone } = await openPhone(browser, baseURL, phonePath, "alice");
  await reviewOnPhone(phone);
  await expect(phone.getByTestId("number-input")).toBeHidden();
  await holdToApprove(phone);

  await expect(phone.getByTestId("feedback")).toContainText("Login approved");
  await expect(page.getByTestId("status")).toHaveAttribute("data-state", "logged-in");
  await context.close();
});
