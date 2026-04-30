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
        // Stub `navigator.serviceWorker` with a no-op rather than `undefined`
        // — `if ("serviceWorker" in navigator)` would still pass for the
        // latter and then throw when calling `.register`.
        const stub = {
          register: () => Promise.reject(new Error("disabled in tests")),
          ready: new Promise(() => {}),
          addEventListener: () => {},
          removeEventListener: () => {},
          getRegistration: () => Promise.resolve(undefined),
          getRegistrations: () => Promise.resolve([]),
        };
        Object.defineProperty(navigator, "serviceWorker", {
          configurable: true,
          get: () => stub,
        });
      } catch {}
    });
    await use(page);
  },
});

export { expect };
