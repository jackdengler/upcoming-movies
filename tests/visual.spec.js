// @ts-check
import { test, expect } from "./fixtures.js";

// Visual regression coverage. Snapshot diffs are sensitive to font hinting
// and platform-specific rendering, so we keep them coarse:
//   - mask out the real release data (text + counts churn weekly)
//   - run only on chromium (the primary target) by default
//   - leave a generous maxDiffPixelRatio
// CI should commit the baseline by running `npx playwright test --update-snapshots`
// once on the canonical environment.

test.describe("visual", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "visual snapshots run only on chromium to avoid cross-engine font drift"
  );

  test("app shell on first paint", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#list .section").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveScreenshot("shell-list.png", {
      fullPage: false,
      // Mask the release data — the test's job is to catch chrome / spacing
      // regressions, not to assert which movies are in the list.
      mask: [page.locator("#list")],
      maxDiffPixelRatio: 0.02,
    });
  });

  test("calendar tab", async ({ page }) => {
    await page.goto("/");
    await page.locator('.tab-bar__btn[data-tab="calendar"]').click();
    await expect(page.locator("#cal-month")).not.toHaveText("—", {
      timeout: 10_000,
    });
    await expect(page).toHaveScreenshot("shell-calendar.png", {
      fullPage: false,
      mask: [page.locator("#cal-grid"), page.locator("#cal-day")],
      maxDiffPixelRatio: 0.02,
    });
  });
});
