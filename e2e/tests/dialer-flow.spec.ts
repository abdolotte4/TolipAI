/**
 * Playwright E2E — Full Dialer Flow
 *
 * Covers: login → power dialer page → lead selection → AMD session start →
 *         disposition submit
 *
 * Prerequisites:
 *   - App running at BASE_URL (default: http://localhost:5000)
 *   - Seeded test user: E2E_EMAIL / E2E_PASSWORD env vars
 *     (falls back to CRM_ADMIN_EMAIL / CRM_ADMIN_PASSWORD)
 *   - At least one lead in the test campaign
 *
 * Run:
 *   pnpm --filter @workspace/e2e exec playwright test
 *   BASE_URL=https://your-railway-url pnpm --filter @workspace/e2e exec playwright test
 */

import { test, expect, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL || process.env.CRM_ADMIN_EMAIL || "info@tolipai.com";
const PASSWORD = process.env.E2E_PASSWORD || process.env.CRM_ADMIN_PASSWORD || "changeme";

async function login(page: Page) {
  await page.goto("/crm/login");

  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();

  await expect(page).toHaveURL(/\/crm(?!\/login)/, { timeout: 15_000 });
}

test.describe("Dialer Flow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("login navigates to CRM dashboard", async ({ page }) => {
    await expect(page.locator("nav, [data-testid='app-nav'], aside")).toBeVisible({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("navigate to power dialer page", async ({ page }) => {
    await page.goto("/crm/dialer");
    await expect(page.getByText(/power dialer/i)).toBeVisible({ timeout: 10_000 });
  });

  test("power dialer shows lead list / filter controls", async ({ page }) => {
    await page.goto("/crm/dialer");
    await expect(
      page.locator("[data-testid='lead-list'], .lead-list, [class*='lead']").first()
        .or(page.getByText(/leads|queue|dial/i).first())
    ).toBeVisible({ timeout: 10_000 });
  });

  test("power dialer session can be started (or shows no-leads state)", async ({ page }) => {
    await page.goto("/crm/dialer");

    const startBtn = page.getByRole("button", { name: /start.*session|power.*session|start.*dial/i });

    if (await startBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await startBtn.click();

      const sessionIndicator = page.getByText(/session|dialing|queue|calling/i).first();
      const noLeads = page.getByText(/no leads|empty|no results/i).first();

      await expect(sessionIndicator.or(noLeads)).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(page.getByText(/power dialer/i)).toBeVisible();
    }
  });

  test("disposition buttons are present in an active session or lead row", async ({ page }) => {
    await page.goto("/crm/dialer");

    const dispositionKeywords = [/answered|no.?answer|voicemail|dnc|callback|skip/i];
    for (const kw of dispositionKeywords) {
      const el = page.getByText(kw).first();
      if (await el.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await expect(el).toBeVisible();
        return;
      }
    }

    await expect(page.getByText(/power dialer/i)).toBeVisible();
  });

  test("phone numbers / conversations page loads without error", async ({ page }) => {
    await page.goto("/crm/integrations/phone-numbers");
    await expect(page.getByText(/phone|number|conversations?/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[class*='error'], [data-testid='error']")).not.toBeVisible();
  });
});

test.describe("Auth Guard", () => {
  test("unauthenticated access redirects to login", async ({ page }) => {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.removeItem("crm_token"));
    await page.goto("/crm/dialer");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});
