const CACHE = "upcoming-v18";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./js/interests.js",
  "./js/activity.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Same-origin GETs use one of two strategies depending on what's being
// fetched:
//   * /data/*.json — network-first. These files (release data, repertory
//     screenings, interests) refresh weekly+ and stale-while-revalidate
//     would force every user to reload twice after a refresh to see new
//     dates. We try the network, cache a fresh copy on success, and fall
//     back to cache only when offline.
//   * Everything else (app shell, icons, etc.) — stale-while-revalidate:
//     serve from cache instantly, refresh in the background.
// Cross-origin requests (api.github.com, TMDB images, etc.) pass through.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isDataJson =
    url.pathname.includes("/data/") && url.pathname.endsWith(".json");

  if (isDataJson) {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
          if (fresh) return fresh;
        } catch {}
        const cached = await cache.match(req);
        if (cached) return cached;
        return new Response("", { status: 503 });
      })
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);

      if (cached) return cached;
      const fresh = await network;
      if (fresh) return fresh;
      if (req.mode === "navigate") {
        const fallback = await cache.match("./index.html");
        if (fallback) return fallback;
      }
      return new Response("", { status: 503 });
    })
  );
});
