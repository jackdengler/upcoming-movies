// @ts-check
import { test, expect } from "./fixtures.js";

test.describe("kind + scope segmented controls", () => {
  test("New Releases is active by default", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.locator('#kind-segmented .segmented__btn[data-kind="releases"]')
    ).toHaveClass(/is-active/);
    await expect(
      page.locator('#kind-segmented .segmented__btn[data-kind="rereleases"]')
    ).not.toHaveClass(/is-active/);
  });

  test("toggling to Rereleases hides the scope segmented and persists", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#scope-segmented")).toBeVisible();

    await page
      .locator('#kind-segmented .segmented__btn[data-kind="rereleases"]')
      .click();
    await expect(
      page.locator('#kind-segmented .segmented__btn[data-kind="rereleases"]')
    ).toHaveClass(/is-active/);
    // Scope only applies to New Releases.
    await expect(page.locator("#scope-segmented")).toBeHidden();

    // Choice persists across reload.
    await page.reload();
    await expect(
      page.locator('#kind-segmented .segmented__btn[data-kind="rereleases"]')
    ).toHaveClass(/is-active/);
  });

  test("scope filter switches between Both / Wide / Limited", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.locator('#scope-segmented .segmented__btn[data-scope="both"]')
    ).toHaveClass(/is-active/);

    await page
      .locator('#scope-segmented .segmented__btn[data-scope="wide"]')
      .click();
    await expect(
      page.locator('#scope-segmented .segmented__btn[data-scope="wide"]')
    ).toHaveClass(/is-active/);
    await expect(
      page.locator('#scope-segmented .segmented__btn[data-scope="both"]')
    ).not.toHaveClass(/is-active/);

    await page
      .locator('#scope-segmented .segmented__btn[data-scope="limited"]')
      .click();
    await expect(
      page.locator('#scope-segmented .segmented__btn[data-scope="limited"]')
    ).toHaveClass(/is-active/);
  });
});
