// @ts-check
import { test, expect } from "./fixtures.js";

test.describe("calendar", () => {
  test("renders the current month and navigates forward and back", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator('.tab-bar__btn[data-tab="calendar"]').click();
    await expect(page.locator("#tab-calendar")).toBeVisible();

    const monthHeader = page.locator("#cal-month");
    await expect(monthHeader).not.toHaveText("—", { timeout: 10_000 });
    const initial = (await monthHeader.textContent())?.trim();
    expect(initial).toBeTruthy();

    await page.locator("#cal-next").click();
    await expect
      .poll(async () => (await monthHeader.textContent())?.trim())
      .not.toBe(initial);

    const next = (await monthHeader.textContent())?.trim();
    await page.locator("#cal-prev").click();
    await expect
      .poll(async () => (await monthHeader.textContent())?.trim())
      .not.toBe(next);
    await expect(monthHeader).toHaveText(initial ?? "");
  });

  test("renders day cells in the grid", async ({ page }) => {
    await page.goto("/");
    await page.locator('.tab-bar__btn[data-tab="calendar"]').click();
    // A month grid is always one of 28/35/42 cells (full weeks).
    await expect
      .poll(async () => await page.locator("#cal-grid > *").count(), {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(28);
    const count = await page.locator("#cal-grid > *").count();
    expect([28, 35, 42]).toContain(count);
  });
});
