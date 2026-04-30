// @ts-check
import { test, expect } from "./fixtures.js";

// Layout / spacing checks. We use bounding boxes and computed styles rather
// than full screenshot diffs so they don't flake on font hinting across
// machines — but they still catch the obvious visual regressions: header
// collapsing, tab bar floating off the bottom, list cards going to zero
// height, segmented buttons wrapping onto two lines.

test.describe("layout", () => {
  test("header has linen-tinted background and reasonable height", async ({
    page,
  }) => {
    await page.goto("/");
    const header = page.locator(".app-header");
    await expect(header).toBeVisible();

    const box = await header.boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThan(80);
    expect(box.height).toBeLessThan(360);

    // Linen base is rgb(245, 239, 230). The default is the translucent
    // `--header-bg` (rgba 0.85), but the @supports fallback uses the solid
    // token. Either way the tint should be 245/239/230.
    const bg = await header.evaluate((el) => getComputedStyle(el).background);
    expect(bg).toMatch(/rgba?\(\s*245,\s*239,\s*230/);
  });

  test("section headers use the PT Serif display font", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#list .section").first()).toBeVisible({
      timeout: 15_000,
    });
    // Month section headers are the canonical display-font surface on the
    // List tab.
    const heading = page.locator("#list .section h2, #list .section .month").first();
    if ((await heading.count()) === 0) return; // app variant: no h2 in section
    const family = await heading.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toMatch(/PT Serif/i);
  });

  test("body text uses the DM Sans default", async ({ page }) => {
    await page.goto("/");
    const family = await page
      .locator(".tab-bar__btn span")
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toMatch(/DM Sans/i);
  });

  test("tab bar is anchored to the bottom of the viewport", async ({
    page,
  }) => {
    await page.goto("/");
    // Wait for the app to finish booting — the service worker may trigger
    // a one-time controllerchange reload on first install, and querying the
    // box mid-navigation throws "Execution context was destroyed".
    await expect(page.locator("#list .section").first()).toBeVisible({
      timeout: 15_000,
    });

    const viewport = page.viewportSize();
    const tabBar = page.locator(".tab-bar");
    await expect(tabBar).toBeVisible();
    await expect(page.locator(".tab-bar .tab-bar__btn")).toHaveCount(3);

    const box = await tabBar.boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThan(40);
    if (viewport) {
      const bottom = box.y + box.height;
      expect(bottom).toBeGreaterThan(viewport.height - 8);
      expect(bottom).toBeLessThanOrEqual(viewport.height + 1);
    }
  });

  test("segmented kind buttons share a single row", async ({ page }) => {
    await page.goto("/");
    const releases = await page
      .locator('#kind-segmented .segmented__btn[data-kind="releases"]')
      .boundingBox();
    const rereleases = await page
      .locator('#kind-segmented .segmented__btn[data-kind="rereleases"]')
      .boundingBox();
    expect(releases).not.toBeNull();
    expect(rereleases).not.toBeNull();
    // Same baseline (within a few px) — i.e. they didn't wrap onto two lines.
    expect(Math.abs(releases.y - rereleases.y)).toBeLessThan(4);
  });

  test("list cards have non-zero height and consistent width", async ({
    page,
  }) => {
    await page.goto("/");
    const sections = page.locator("#list .section");
    // Wait for renderListTab to settle — it can re-render after async data
    // loads, so use `poll` to find a stable, non-zero count.
    await expect
      .poll(async () => await sections.count(), { timeout: 15_000 })
      .toBeGreaterThan(0);

    const count = await sections.count();
    const widths = new Set();
    for (let i = 0; i < Math.min(count, 4); i++) {
      const box = await sections.nth(i).boundingBox();
      if (!box) continue; // a section might re-render mid-loop
      expect(box.height).toBeGreaterThan(40);
      widths.add(Math.round(box.width));
    }
    expect(widths.size).toBeGreaterThan(0);
    // All visible cards share the same horizontal extent — no rogue card
    // escaping the column.
    expect(widths.size).toBe(1);
  });

  test("safe-area paddings take effect when defined", async ({ page }) => {
    await page.goto("/");
    // The shell sets `--safe-top` and `--safe-bottom` on :root, used by the
    // header and tab bar. They should resolve to a number, even if zero.
    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        top: cs.getPropertyValue("--safe-top").trim(),
        bottom: cs.getPropertyValue("--safe-bottom").trim(),
      };
    });
    expect(tokens.top).toMatch(/^[0-9.]+(px|em|rem)?$|^env\(/);
    expect(tokens.bottom).toMatch(/^[0-9.]+(px|em|rem)?$|^env\(/);
  });
});
