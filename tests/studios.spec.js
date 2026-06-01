// @ts-check
import { test, expect } from "./fixtures.js";

test.describe("studios tab", () => {
  test("shows the seeded major distributors", async ({ page }) => {
    await page.goto("/");
    await page.locator('.tab-bar__btn[data-tab="studios"]').click();
    await expect(page.locator("#tab-studios")).toBeVisible();
    await expect(page.locator("#tab-list")).toBeHidden();
    await expect(
      page.locator('.tab-bar__btn[data-tab="studios"]')
    ).toHaveClass(/is-active/);

    const rows = page.locator("#studio-list .director-row");
    // The default seed ships twelve major distributors.
    await expect(rows).toHaveCount(12);
    await expect(rows.first().locator(".director-row__name")).toHaveText(
      "Walt Disney Studios Motion Pictures"
    );
  });

  test("adds a studio and toggles its releases open and closed", async ({ page }) => {
    await page.goto("/");
    await page.locator('.tab-bar__btn[data-tab="studios"]').click();

    await page.locator("#add-studio").click();
    await expect(page.locator("#studio-dialog")).toBeVisible();
    await page.locator("#studio-name").fill("MUBI");
    await page.locator("#studio-form button[type=submit]").click();

    const rows = page.locator("#studio-list .director-row");
    await expect(rows).toHaveCount(13);
    await expect(rows.last().locator(".director-row__name")).toHaveText("MUBI");

    // Studios start collapsed — the release list is hidden until expanded.
    const first = rows.first();
    const details = first.locator(".director-filmography");
    await expect(details).toBeHidden();

    await first.locator(".director-row__expand").click();
    await expect(details).toBeVisible();

    // And it collapses again on a second tap.
    await first.locator(".director-row__expand").click();
    await expect(details).toBeHidden();
  });

  test("cycles interest by tapping a film chip", async ({ page }) => {
    // A PAT gates interest writes (same as the List tab); seed a dummy one so
    // the tap sets interest locally instead of opening the token dialog.
    await page.addInitScript(() =>
      localStorage.setItem("upcoming:gh_pat", "test-token")
    );
    await page.goto("/");
    await page.locator('.tab-bar__btn[data-tab="studios"]').click();

    const first = page.locator("#studio-list .director-row").first();
    await first.locator(".director-row__expand").click();

    const chip = () => first.locator(".director-film__rate").first();
    await expect(chip()).toHaveText("Rate");
    await chip().click();
    await expect(chip()).toHaveText("Must");
    await chip().click();
    await expect(chip()).toHaveText("Likely");
  });
});
