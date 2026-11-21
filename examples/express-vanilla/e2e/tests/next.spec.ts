import { test, expect } from "@playwright/test";
import { API_BASE, decodeQrFrom, openPhone, phonePathFromQr, reviewOnPhone } from "../helpers";

// The Next.js app renders <qr-device-login> on the client only, and reaches
// the API through its own /device proxy (app/device/[...path]/route.ts).

const element = (page: import("@playwright/test").Page) => page.locator("qr-device-login");

test("the server renders the tag, and the page has no hydration or runtime errors", async ({ page, request }) => {
  const html = await (await request.get("/")).text();
  expect(html).toContain("<qr-device-login");

  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
  });

  await page.goto("/");
  await expect(element(page).locator('[part="code"]')).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  expect(problems).toEqual([]);
});

test("the /device proxy forwards requests to the API", async ({ request }) => {
  const created = await request.post("/device/code");
  expect(created.status()).toBe(200);
  const challenge = await created.json();
  expect(challenge.device_code).toEqual(expect.any(String));
  expect(challenge.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  const status = await request.get(`/device/status?device_code=${challenge.device_code}`);
  expect(await status.json()).toEqual({ status: "pending" });
});

test("the proxy passes API errors through unchanged", async ({ request }) => {
  const res = await request.get("/device/status");
  expect(res.status()).toBe(400);
  expect(await res.json()).toMatchObject({ code: "invalid_request" });
});

test("the requester IP reaches the API through the proxy", async ({ request }) => {
  const created = await request.post("/device/code", { headers: { "x-forwarded-for": "203.0.113.9" } });
  const challenge = await created.json();

  const scan = await request.post(`${API_BASE}/device/scan`, {
    headers: { Authorization: "Bearer alice", "Content-Type": "application/json" },
    data: { user_code: challenge.user_code },
  });
  expect((await scan.json()).requester_info.ip).toBe("203.0.113.9");
});

test("a phone approves the login, and the Next page gets the session via the proxy", async ({ page, browser }) => {
  await page.goto("/");
  const code = element(page).locator('[part="code"]');
  await expect(code).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const userCode = (await code.textContent())!.trim();

  const phonePath = await phonePathFromQr(element(page).locator("img"), userCode);
  const { context, phone } = await openPhone(browser, API_BASE, phonePath, "alice");
  await reviewOnPhone(phone);
  await phone.getByTestId("approve-btn").click();
  await expect(phone.getByTestId("feedback")).toContainText("Login approved");

  await expect(element(page)).toHaveAttribute("data-state", "logged-in");
  const events = await page.evaluate(() => (window as any).qrEvents as Array<{ type: string; detail: any }>);
  expect(events.find((e) => e.type === "qr-approved")?.detail.session.accessToken).toContain("demo-token-alice");

  await context.close();
});
