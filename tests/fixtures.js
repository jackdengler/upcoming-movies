// @ts-check
import { test as base, expect } from "@playwright/test";

// All app tests share one extension to the default Playwright fixture: we
// disable the PWA service worker before any page script runs. The SW's
// `controllerchange` handler triggers a `location.reload()` on first
// install, which races with our queries and surfaces as
// "Execution context was destroyed" failures.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "serviceWorker", {
          configurable: true,
          get: () => undefined,
        });
      } catch {}
    });
    await use(page);
  },
});

export { expect };
