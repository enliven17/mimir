import { expect, test, type Page } from "@playwright/test";

/** Fail the test on any uncaught error in the page. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test("home renders and links into the app", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("link", { name: /launch app/i }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("explorer renders with the onboarding checklist for a new visitor", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/en/explorer");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.getByText(/connect a wallet/i).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("create form asks for a wallet instead of failing", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/en/vs/create");
  await expect(page.locator("form, [role=form], textarea, input").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("dashboard shows the wallet gate when disconnected", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/en/dashboard");
  await expect(page.getByRole("button", { name: /connect/i }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("calibration and copy pages render without a database or feature flag", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/en/calibration");
  await expect(page.getByText(/brier/i).first()).toBeVisible();
  await page.goto("/en/copy");
  await expect(page.locator("main, body").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("security headers are sent", async ({ request }) => {
  const res = await request.get("/en");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("paid endpoints refuse bad input before asking for payment", async ({ request }) => {
  const res = await request.get("/api/premium/price?symbol=BAD%20SYMBOL");
  expect(res.status()).toBe(400);
});
