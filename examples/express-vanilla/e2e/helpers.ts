import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import jsQR from "jsqr";
import { PNG } from "pngjs";

/**
 * Decodes a QR code image, the way a phone camera would.
 * Returns the text the QR encodes (the verification URL).
 */
export async function decodeQrFrom(image: Locator): Promise<string> {
  const png = await image.screenshot();
  const { data, width, height } = PNG.sync.read(png);
  const code = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height);
  if (!code) throw new Error("QR code could not be decoded from the page");
  return code.data;
}

/** Decodes the QR on the express-vanilla login page (data-testid="qr"). */
export function decodeQr(page: Page): Promise<string> {
  return decodeQrFrom(page.getByTestId("qr"));
}

/** Base URL of the Express API (login pages, /device, mobile.html). */
export const API_BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export type Transport = "sse" | "polling";

export interface WebLogin {
  /** The code the page shows under the QR. */
  userCode: string;
  /** The two-digit number the phone must confirm. */
  verificationNumber: string;
  /** Path + query encoded in the QR, e.g. /mobile.html?user_code=ABCD-EFGH. */
  phonePath: string;
}

/**
 * Checks that a QR encodes the mobile page for this login code, and returns the
 * path the phone should open.
 */
export async function phonePathFromQr(image: Locator, userCode: string): Promise<string> {
  const qrUrl = new URL(await decodeQrFrom(image));
  expect(qrUrl.pathname).toBe("/mobile.html");
  expect(qrUrl.searchParams.get("user_code")).toBe(userCode);
  return `${qrUrl.pathname}${qrUrl.search}`;
}

/**
 * Opens the login page (express-vanilla). Verifies the QR encodes this login's
 * code, then returns what the phone needs to open.
 */
export async function startWebLogin(page: Page, transport: Transport): Promise<WebLogin> {
  await page.goto(`/?transport=${transport}`);
  await expect(page.getByTestId("transport")).toHaveText(transport);
  await expect(page.getByTestId("qr")).toHaveAttribute("src", /^data:image\/svg\+xml/);
  await expect(page.getByTestId("user-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const userCode = (await page.getByTestId("user-code").textContent())!.trim();
  const verificationNumber = await page.getByTestId("verification-number-value").textContent();
  expect(verificationNumber).toMatch(/^\d{2}$/);
  return {
    userCode,
    verificationNumber: verificationNumber!.trim(),
    phonePath: await phonePathFromQr(page.getByTestId("qr"), userCode),
  };
}

/** Opens the phone page (a separate browser context) and signs in as `userId`. */
export async function openPhone(browser: Browser, baseURL: string | undefined, phonePath: string, userId: string) {
  const context = await browser.newContext({ baseURL });
  const phone = await context.newPage();
  await phone.goto(phonePath);
  await phone.getByTestId("user-id").fill(userId);
  return { context, phone };
}

/** The phone reviews the request, as the consent step requires. */
export async function reviewOnPhone(phone: Page): Promise<void> {
  await phone.getByTestId("review-btn").click();
  await expect(phone.getByTestId("consent")).toBeVisible();
}

/**
 * Approving takes a one-second hold on the button (see mobile.ts). A click is
 * not enough, so this holds the mouse down past the threshold.
 */
export async function holdToApprove(phone: Page): Promise<void> {
  const button = phone.getByTestId("approve-btn");
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error("approve button is not visible");
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await phone.mouse.down();
  await phone.waitForTimeout(1300); // longer than the one-second hold
  await phone.mouse.up();
}

/** The phone types the number from the login screen, then holds approve. */
export async function approveOnPhone(phone: Page, verificationNumber: string): Promise<void> {
  await phone.getByTestId("number-input").fill(verificationNumber);
  await holdToApprove(phone);
}
