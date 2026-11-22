import { test, expect, type Page } from "@playwright/test";
import { approveOnPhone, openPhone, phonePathFromQr, reviewOnPhone } from "../helpers";

// <qr-device-login> is tested on plain HTML, React 19 and Vue 3.
// Playwright's locators pierce the element's open shadow root.

type LoggedEvent = { type: string; detail: any };

const element = (page: Page) => page.locator("qr-device-login");
const events = (page: Page) => page.evaluate(() => (window as any).qrEvents as LoggedEvent[]);

async function waitForCode(page: Page): Promise<string> {
  const code = element(page).locator('[part="code"]');
  await expect(code).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  return (await code.textContent())!.trim();
}

const PAGES = [
  { name: "plain HTML", path: "/element.html" },
  { name: "React", path: "/react.html" },
  { name: "Vue 3", path: "/vue.html" },
];

for (const demo of PAGES) {
  test.describe(`<qr-device-login> on ${demo.name}`, () => {
    test("renders a QR for this login, the phone approves, the element emits the session", async ({ page, browser, baseURL }) => {
      await page.goto(demo.path);
      const userCode = await waitForCode(page);
      const phonePath = await phonePathFromQr(element(page).locator("img"), userCode);

      const verificationNumber = await element(page).locator('[part="number-value"]').textContent();
      const { context, phone } = await openPhone(browser, baseURL, phonePath, "alice");
      await reviewOnPhone(phone);
      await expect(element(page)).toHaveAttribute("data-state", "scanned");
      await approveOnPhone(phone, verificationNumber!.trim());
      await expect(phone.getByTestId("feedback")).toContainText("Login approved");

      await expect(element(page)).toHaveAttribute("data-state", "logged-in");
      const log = await events(page);
      expect(log.map((e) => e.type)).toEqual(expect.arrayContaining(["qr-state", "qr-approved"]));
      const states = log.filter((e) => e.type === "qr-state").map((e) => e.detail.status);
      expect(states).toEqual(expect.arrayContaining(["pending", "scanned", "approved"]));
      const approved = log.find((e) => e.type === "qr-approved")!;
      expect(approved.detail.session.accessToken).toContain("demo-token-alice");

      // The token goes out in the event only; it never reaches the DOM.
      const rendered = await page.evaluate(() => {
        const host = document.querySelector("qr-device-login")!;
        return host.shadowRoot!.textContent + " " + document.body.textContent;
      });
      expect(rendered).not.toContain("demo-token");

      await context.close();
    });

    test("a denial is reported as a state, not as an error", async ({ page, browser, baseURL }) => {
      await page.goto(demo.path);
      const userCode = await waitForCode(page);
      const phonePath = await phonePathFromQr(element(page).locator("img"), userCode);

      const { context, phone } = await openPhone(browser, baseURL, phonePath, "alice");
      await reviewOnPhone(phone);
      await phone.getByTestId("deny-btn").click();

      await expect(element(page)).toHaveAttribute("data-state", "denied");
      const log = await events(page);
      expect(log.some((e) => e.type === "qr-error")).toBe(false);
      expect(log.some((e) => e.type === "qr-state" && e.detail.status === "denied")).toBe(true);

      await context.close();
    });
  });
}

test("changing an attribute restarts the login with a new code", async ({ page }) => {
  await page.goto("/element.html");
  const first = await waitForCode(page);

  await element(page).evaluate((el) => el.setAttribute("qr-size", "300"));

  await expect.poll(() => waitForCode(page)).not.toBe(first);
  await expect(element(page).locator("img")).toHaveAttribute("src", /^data:image\/svg\+xml/);
});

test("a missing endpoint is reported as an error event", async ({ page }) => {
  await page.goto("/element.html");
  await page.evaluate(() => {
    const el = document.querySelector("qr-device-login")!;
    el.removeAttribute("endpoint");
    el.setAttribute("qr-size", "200"); // triggers a restart without an endpoint
  });
  await expect(element(page).locator('[part="error"]')).toContainText("needs an endpoint");
  const log = await events(page);
  expect(log.some((e) => e.type === "qr-error")).toBe(true);
});

test("auto-regenerate replaces an expired code without user action", async ({ page }) => {
  // Server TTL is 30 s (see playwright.config.ts).
  await page.goto("/element.html?auto-regenerate");
  const first = await waitForCode(page);
  const firstSrc = await element(page).locator("img").getAttribute("src");

  await expect.poll(() => waitForCode(page), { timeout: 50_000, intervals: [1000] }).not.toBe(first);
  await expect(element(page)).toHaveAttribute("data-state", "pending");
  await expect(element(page).locator("img")).not.toHaveAttribute("src", firstSrc!);
  await expect(element(page).locator('[part="retry"]')).toBeHidden();
});
