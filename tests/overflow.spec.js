import { test, expect } from "./fixtures.js";

// Reproduces a horizontal-overflow regression on the Calendar tab at phone
// widths after a second filter-row toggle was added. Uses an iPhone-sized
// viewport on chromium so the project runs in CI without webkit.
test.use({ viewport: { width: 390, height: 844 } });

test.describe("no horizontal overflow at phone width", () => {
  for (const tab of ["list", "calendar", "interests"]) {
    test(`${tab} tab does not horizontal-scroll`, async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await page.locator(`.tab-bar__btn[data-tab="${tab}"]`).click();
      await page.waitForTimeout(500);
      const measure = await page.evaluate(() => ({
        bodyScroll: document.body.scrollWidth,
        bodyClient: document.body.clientWidth,
        docScroll: document.documentElement.scrollWidth,
        docClient: document.documentElement.clientWidth,
        filterRowScroll: document.querySelector(".app-header__filter-row")?.scrollWidth ?? 0,
        filterRowClient: document.querySelector(".app-header__filter-row")?.clientWidth ?? 0,
      }));
      expect(measure.bodyScroll, JSON.stringify(measure)).toBeLessThanOrEqual(measure.bodyClient);
      expect(measure.docScroll, JSON.stringify(measure)).toBeLessThanOrEqual(measure.docClient);
    });
  }
});
