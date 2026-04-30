// @ts-check
import { test, expect } from "./fixtures.js";

// `.empty-state` overrides the [hidden] attribute via author CSS, so
// `toBeHidden()` returns false even when `hidden=""` is set. We assert
// against the attribute directly instead.
const isHidden = async (locator) =>
  (await locator.getAttribute("hidden")) !== null;

test.describe("search", () => {
  test("search bar is hidden until the header search icon is tapped", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#list .section").first()).toBeVisible({
      timeout: 15_000,
    });
    // Hidden on first paint — the icon is the entry point.
    await expect.poll(() => isHidden(page.locator("#search-bar"))).toBe(true);
    await expect(page.locator("#open-search")).toHaveAttribute(
      "aria-expanded",
      "false"
    );

    await page.locator("#open-search").click();
    await expect.poll(() => isHidden(page.locator("#search-bar"))).toBe(false);
    await expect(page.locator("#open-search")).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    // Input gets keyboard focus so the user can type immediately.
    await expect(page.locator("#search-input")).toBeFocused();
  });

  test("toggling the icon collapses the bar and clears any query", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#list .section").first()).toBeVisible({
      timeout: 15_000,
    });

    await page.locator("#open-search").click();
    await page.locator("#search-input").fill("zzzzz-no-such-movie-zzzzz");
    await expect.poll(() => isHidden(page.locator("#empty-year"))).toBe(false);

    // Second tap on the icon dismisses the bar AND resets the query so the
    // list isn't left filtered behind a hidden input.
    await page.locator("#open-search").click();
    await expect.poll(() => isHidden(page.locator("#search-bar"))).toBe(true);
    await expect(page.locator("#search-input")).toHaveValue("");
    await expect.poll(() => isHidden(page.locator("#empty-year"))).toBe(true);
    await expect(page.locator("#list .section").first()).toBeVisible();
  });

  test("Escape inside the input collapses the bar", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#list .section").first()).toBeVisible({
      timeout: 15_000,
    });
    await page.locator("#open-search").click();
    await expect.poll(() => isHidden(page.locator("#search-bar"))).toBe(false);

    await page.locator("#search-input").press("Escape");
    await expect.poll(() => isHidden(page.locator("#search-bar"))).toBe(true);
  });

  test("filters releases and shows the empty state for nonsense queries", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#list .section").first()).toBeVisible({
      timeout: 15_000,
    });

    await page.locator("#open-search").click();
    await page.locator("#search-input").fill("zzzzz-no-such-movie-zzzzz");

    const empty = page.locator("#empty-year");
    await expect(empty).toContainText(/No releases match your search/i);
    await expect.poll(() => isHidden(empty)).toBe(false);
    await expect(page.locator("#search-clear")).toBeVisible();
  });

  test("clear button empties the query and keeps the bar open", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#list .section").first()).toBeVisible({
      timeout: 15_000,
    });

    await page.locator("#open-search").click();
    await page.locator("#search-input").fill("zzzzz-no-such-movie-zzzzz");
    const empty = page.locator("#empty-year");
    await expect.poll(() => isHidden(empty)).toBe(false);

    await page.locator("#search-clear").click();
    await expect(page.locator("#search-input")).toHaveValue("");
    await expect.poll(() => isHidden(empty)).toBe(true);
    await expect(page.locator("#list .section").first()).toBeVisible();
    // Bar stays open — user can keep typing a new query without re-tapping
    // the icon. Closing is the icon's job.
    await expect.poll(() => isHidden(page.locator("#search-bar"))).toBe(false);
  });
});
