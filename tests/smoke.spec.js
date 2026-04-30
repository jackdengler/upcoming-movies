// @ts-check
import { test, expect } from "./fixtures.js";

// Each test gets a fresh browser context, so localStorage is naturally empty.
// We deliberately do NOT clear storage in beforeEach — that would also wipe
// state on `page.reload()` and break persistence tests.

test.describe("smoke", () => {
  test("loads the app shell and shows the title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Upcoming Movies");
    await expect(page.locator("#view-title")).toHaveText("Upcoming");
    await expect(page.locator(".tab-bar")).toBeVisible();
  });

  test("List tab is the default active tab", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#tab-list")).toBeVisible();
    await expect(page.locator("#tab-calendar")).toBeHidden();
    await expect(page.locator("#tab-interests")).toBeHidden();
    await expect(
      page.locator('.tab-bar__btn[data-tab="list"]')
    ).toHaveClass(/is-active/);
  });

  test("renders at least one month section once data loads", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#list .section").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("loads without console errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
    });
    await page.goto("/");
    await expect(page.locator("#list .section").first()).toBeVisible({
      timeout: 15_000,
    });
    // The static repo doesn't ship icons under tests, and offline test runs
    // can't fetch Google Fonts — filter those out so we only catch real
    // app-level errors.
    const real = errors.filter(
      (e) =>
        !/icons\/|apple-touch-icon|favicon|manifest/i.test(e) &&
        !/fonts\.googleapis|fonts\.gstatic|ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/i.test(
          e
        )
    );
    expect(real, real.join("\n")).toEqual([]);
  });
});
