// @ts-check
import { test, expect } from "./fixtures.js";

// `.empty-state` overrides the [hidden] attribute via author CSS, so
// `toBeHidden()` returns false even when `hidden=""` is set. We assert
// against the attribute directly instead.
const isHidden = async (locator) =>
  (await locator.getAttribute("hidden")) !== null;

test.describe("search", () => {
  test("filters releases and shows the empty state for nonsense queries", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#list .section").first()).toBeVisible({
      timeout: 15_000,
    });

    await page.locator("#search-input").fill("zzzzz-no-such-movie-zzzzz");

    const empty = page.locator("#empty-year");
    await expect(empty).toContainText(/No releases match your search/i);
    await expect.poll(() => isHidden(empty)).toBe(false);
    await expect(page.locator("#search-clear")).toBeVisible();
  });

  test("clear button restores the list", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#list .section").first()).toBeVisible({
      timeout: 15_000,
    });

    await page.locator("#search-input").fill("zzzzz-no-such-movie-zzzzz");
    const empty = page.locator("#empty-year");
    await expect.poll(() => isHidden(empty)).toBe(false);

    await page.locator("#search-clear").click();
    await expect(page.locator("#search-input")).toHaveValue("");
    await expect.poll(() => isHidden(empty)).toBe(true);
    await expect(page.locator("#list .section").first()).toBeVisible();
  });
});
