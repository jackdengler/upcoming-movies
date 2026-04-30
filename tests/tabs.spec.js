// @ts-check
import { test, expect } from "./fixtures.js";

test.describe("tab navigation", () => {
  test("switches to Calendar and back to List", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#tab-list")).toBeVisible();

    await page.locator('.tab-bar__btn[data-tab="calendar"]').click();
    await expect(page.locator("#tab-calendar")).toBeVisible();
    await expect(page.locator("#tab-list")).toBeHidden();
    await expect(
      page.locator('.tab-bar__btn[data-tab="calendar"]')
    ).toHaveClass(/is-active/);
    await expect(page.locator("#cal-month")).not.toHaveText("—", {
      timeout: 10_000,
    });

    await page.locator('.tab-bar__btn[data-tab="list"]').click();
    await expect(page.locator("#tab-list")).toBeVisible();
    await expect(page.locator("#tab-calendar")).toBeHidden();
  });

  test("switches to Interests tab", async ({ page }) => {
    await page.goto("/");
    await page.locator('.tab-bar__btn[data-tab="interests"]').click();
    await expect(page.locator("#tab-interests")).toBeVisible();
    await expect(page.locator("#tab-list")).toBeHidden();
    await expect(page.locator("#tab-calendar")).toBeHidden();
  });

  test("opens and closes the Updates overlay", async ({ page }) => {
    await page.goto("/");
    await page.locator("#open-updates").click();
    await expect(page.locator("#tab-updates")).toBeVisible();

    await page.locator("#updates-back").click();
    await expect(page.locator("#tab-updates")).toBeHidden();
    // Returning from the overlay should land us back on the list.
    await expect(page.locator("#tab-list")).toBeVisible();
  });
});
