// @ts-check
import { test, expect } from "./fixtures.js";

// When upcoming-movies runs inside the central-optimus launcher iframe,
// iOS WebKit still exposes env(safe-area-inset-*) values to the iframe.
// The launcher's embed-bar has already absorbed that space, so the inner
// app's header and tab bar reserve it AGAIN — producing a visible band of
// dead space above the "Upcoming" title and below the tab bar.
//
// These tests assert the embedded-mode contract: when the page detects it
// is in an iframe, it zeros out --safe-top / --safe-bottom and stops
// double-padding.

const PARENT_HOST = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0">
  <iframe id="embed" src="/index.html"
          style="position:fixed;inset:0;width:100vw;height:100vh;border:0">
  </iframe>
</body></html>`;

async function loadEmbedded(page) {
  // Use a real iframe with a same-origin src so we can introspect its
  // documentElement and computed styles.
  await page.goto("/about:blank-host", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.setContent(PARENT_HOST, { waitUntil: "domcontentloaded" });
}

test.describe("embedded-mode spacing", () => {
  test("html element gets the `embedded` class when loaded in an iframe", async ({
    page,
  }) => {
    await loadEmbedded(page);
    const frame = page.frameLocator("#embed");
    await expect(frame.locator("#view-title")).toBeVisible({
      timeout: 15_000,
    });
    const isEmbedded = await page.evaluate(() => {
      const f = /** @type {HTMLIFrameElement} */ (
        document.getElementById("embed")
      );
      return !!f.contentDocument?.documentElement.classList.contains(
        "embedded"
      );
    });
    expect(isEmbedded).toBe(true);
  });

  test("standalone load does NOT get the `embedded` class", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#view-title")).toBeVisible();
    const isEmbedded = await page
      .locator("html")
      .evaluate((el) => el.classList.contains("embedded"));
    expect(isEmbedded).toBe(false);
  });

  test("--safe-top collapses to a small buffer (--space-2) when embedded; --safe-bottom is zeroed", async ({
    page,
  }) => {
    await loadEmbedded(page);
    const frame = page.frameLocator("#embed");
    await expect(frame.locator("#view-title")).toBeVisible({
      timeout: 15_000,
    });
    const tokens = await page.evaluate(() => {
      const f = /** @type {HTMLIFrameElement} */ (
        document.getElementById("embed")
      );
      const cs = f.contentDocument
        ? getComputedStyle(f.contentDocument.documentElement)
        : null;
      return {
        top: cs?.getPropertyValue("--safe-top").trim() ?? "",
        bottom: cs?.getPropertyValue("--safe-bottom").trim() ?? "",
      };
    });
    // 8px buffer above; 0 below (host owns home-indicator space).
    expect(tokens.top).toBe("8px");
    expect(tokens.bottom).toMatch(/^(0|0px)$/);
  });

  test("header keeps a small buffer above the title when embedded", async ({
    page,
  }) => {
    await loadEmbedded(page);
    const frame = page.frameLocator("#embed");
    await expect(frame.locator("#view-title")).toBeVisible({
      timeout: 15_000,
    });
    // The header sits at the iframe's top edge.
    const top = await frame
      .locator(".app-header")
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeLessThanOrEqual(1);
    // ...but its top padding is the small embedded buffer, not 0 and not
    // the device safe-area inset.
    const headerPad = await frame
      .locator(".app-header")
      .evaluate((el) => getComputedStyle(el).paddingTop);
    expect(headerPad).toBe("8px");
  });

  test("tab bar sits flush at the bottom of the embedded viewport", async ({
    page,
  }) => {
    await loadEmbedded(page);
    const frame = page.frameLocator("#embed");
    await expect(frame.locator(".tab-bar")).toBeVisible({ timeout: 15_000 });

    const measurements = await page.evaluate(() => {
      const f = /** @type {HTMLIFrameElement} */ (
        document.getElementById("embed")
      );
      const doc = f.contentDocument;
      const win = f.contentWindow;
      if (!doc || !win) return null;
      const tabBar = doc.querySelector(".tab-bar");
      if (!tabBar) return null;
      const r = tabBar.getBoundingClientRect();
      return {
        gap: win.innerHeight - r.bottom,
        padBottom: getComputedStyle(tabBar).paddingBottom,
      };
    });
    expect(measurements).not.toBeNull();
    // No gap between the tab bar's bottom edge and the iframe bottom.
    expect(Math.abs(measurements.gap)).toBeLessThan(2);
    // Padding-bottom collapses to the small base inset (no safe-area added).
    // base inset is --space-1 = 4px.
    expect(measurements.padBottom).toBe("4px");
  });

  test("embedded override beats simulated iOS safe-area insets", async ({
    page,
  }) => {
    // Linux Chromium reports env(safe-area-inset-*) as 0, so the gap the
    // user sees on iOS doesn't reproduce here. To prove the override holds
    // even when env() is non-zero (as on iOS WebKit inside an iframe), we
    // inject a fake safe-area into the iframe's :root and check the
    // header / tab-bar still collapse to flush.
    await loadEmbedded(page);
    const frame = page.frameLocator("#embed");
    await expect(frame.locator("#view-title")).toBeVisible({
      timeout: 15_000,
    });

    await page.evaluate(() => {
      const f = /** @type {HTMLIFrameElement} */ (
        document.getElementById("embed")
      );
      const doc = f.contentDocument;
      if (!doc) return;
      const style = doc.createElement("style");
      // Specificity (0,1,0). The embedded override must be more specific.
      style.textContent = `:root { --safe-top: 47px; --safe-bottom: 34px; }`;
      doc.head.appendChild(style);
    });

    const result = await page.evaluate(() => {
      const f = /** @type {HTMLIFrameElement} */ (
        document.getElementById("embed")
      );
      const doc = f.contentDocument;
      if (!doc) return null;
      const root = getComputedStyle(doc.documentElement);
      const header = doc.querySelector(".app-header");
      const tabBar = doc.querySelector(".tab-bar");
      return {
        safeTop: root.getPropertyValue("--safe-top").trim(),
        safeBottom: root.getPropertyValue("--safe-bottom").trim(),
        headerPadTop: header ? getComputedStyle(header).paddingTop : "",
        tabBarPadBottom: tabBar ? getComputedStyle(tabBar).paddingBottom : "",
      };
    });
    expect(result).not.toBeNull();
    expect(result.safeTop).toBe("8px");
    expect(result.safeBottom).toMatch(/^(0|0px)$/);
    expect(result.headerPadTop).toBe("8px");
    expect(result.tabBarPadBottom).toBe("4px");
  });
});
