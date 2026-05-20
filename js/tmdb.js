// TMDB filmography fetcher for the Directors tab.
//
// The user pastes their TMDB v4 read-access token (same one the scripts/
// scrapers use) into a settings dialog; we store it in localStorage and use
// Bearer auth against v3 endpoints. Each director's directing credits are
// cached in localStorage so repeat expands don't hit the API. We refresh
// stale entries in the background (network-first) but still paint the cached
// list instantly.

const TMDB_BASE = "https://api.themoviedb.org/3";
const TOKEN_KEY = "upcoming:tmdb_token";
const CACHE_PREFIX = "upcoming:filmography:";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const inflight = new Map(); // name → Promise

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

export function setToken(token) {
  if (!token) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  localStorage.setItem(TOKEN_KEY, token);
}

export function hasToken() {
  return Boolean(getToken());
}

export function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cacheKey(name) {
  return `${CACHE_PREFIX}${normalizeName(name)}`;
}

export function getCached(name) {
  try {
    const raw = localStorage.getItem(cacheKey(name));
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j?.fetchedAt || !Array.isArray(j.films)) return null;
    return j;
  } catch {
    return null;
  }
}

function writeCache(name, films, tmdbId) {
  try {
    localStorage.setItem(cacheKey(name), JSON.stringify({
      fetchedAt: new Date().toISOString(),
      tmdbId: tmdbId || null,
      films,
    }));
  } catch {}
}

function isFresh(entry) {
  if (!entry?.fetchedAt) return false;
  return (Date.now() - new Date(entry.fetchedAt).getTime()) < CACHE_TTL_MS;
}

async function tmdb(path) {
  const token = getToken();
  if (!token) throw new Error("no-token");
  const r = await fetch(`${TMDB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (r.status === 401) throw new Error("bad-token");
  if (!r.ok) throw new Error(`tmdb-${r.status}`);
  return r.json();
}

async function findPerson(name) {
  const j = await tmdb(`/search/person?include_adult=false&query=${encodeURIComponent(name)}`);
  const results = Array.isArray(j.results) ? j.results : [];
  if (!results.length) return null;
  const target = normalizeName(name);
  // Prefer an exact normalized-name match; fall back to the most-popular hit.
  const exact = results.find((r) => normalizeName(r.name) === target);
  return exact || results[0];
}

// Returns { films: [{ id, title, date }], tmdbId } sorted newest-first.
// Throws "no-token", "bad-token", "not-found", or "tmdb-NNN".
async function fetchFresh(name) {
  const person = await findPerson(name);
  if (!person) throw new Error("not-found");
  const j = await tmdb(`/person/${person.id}/movie_credits`);
  const crew = Array.isArray(j.crew) ? j.crew : [];
  const films = crew
    .filter((c) => c.job === "Director")
    .map((c) => ({
      id: c.id,
      title: c.title || c.original_title || "",
      date: c.release_date || "",
    }))
    .filter((f) => f.title)
    // Dedupe (TMDB can list a director twice when crewed under multiple jobs).
    .filter((f, idx, arr) => arr.findIndex((g) => g.id === f.id) === idx)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return { tmdbId: person.id, films };
}

// Cache-then-network. Returns the cached entry immediately if any; the
// optional `onFresh` callback fires later with the refreshed payload (or an
// error). If nothing is cached, awaits the network and returns that.
export async function getFilmography(name, onFresh) {
  const key = normalizeName(name);
  if (!key) return null;
  const cached = getCached(name);
  if (cached && isFresh(cached)) {
    // Still serve cached; no network refresh needed.
    return cached;
  }
  // Either no cache or stale — kick off a fetch. Coalesce concurrent calls.
  let promise = inflight.get(key);
  if (!promise) {
    promise = fetchFresh(name)
      .then((res) => {
        writeCache(name, res.films, res.tmdbId);
        return { fetchedAt: new Date().toISOString(), films: res.films, tmdbId: res.tmdbId };
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
  }
  if (cached) {
    // Hand back stale cache now; refresh in background.
    promise.then((fresh) => onFresh?.(null, fresh)).catch((err) => onFresh?.(err, null));
    return cached;
  }
  return promise;
}
