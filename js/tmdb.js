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
// Cache schema:
//   v1 — unfiltered films array.
//   v2 — runtime/sole-director filter; films array.
//   v3 — split into { released, upcoming } so the inline films section can
//        surface in-production / rumored titles next to the local schedule.
const CACHE_PREFIX = "upcoming:filmography:v3:";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// AMPAS defines "feature" as any film >40 minutes. Anything shorter is a
// short; that's the only thing we filter out on runtime. Films missing
// runtime data (usually unreleased) are kept.
const FEATURE_MIN_RUNTIME = 40;
// How many parallel /movie/{id} requests to keep in flight per filmography
// fetch. TMDB no longer enforces a hard rate limit but blasting 30 requests
// at once is impolite; 8 keeps a busy director (~25 features) under 4s.
const DETAIL_BATCH_SIZE = 8;

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
    if (!j?.fetchedAt) return null;
    if (!Array.isArray(j.released) || !Array.isArray(j.upcoming)) return null;
    return j;
  } catch {
    return null;
  }
}

function writeCache(name, payload) {
  try {
    localStorage.setItem(cacheKey(name), JSON.stringify({
      fetchedAt: new Date().toISOString(),
      tmdbId: payload.tmdbId || null,
      released: payload.released,
      upcoming: payload.upcoming,
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

// Search TMDB's people database for the Add Director autocomplete. Returns
// up to 8 hits, with Directing-department people surfaced first and the rest
// (writer-directors, actor-directors, etc.) kept as backups. Each hit
// includes a short "known for" hint to disambiguate same-name people.
export async function searchPeople(query) {
  const q = String(query || "").trim();
  if (q.length < 2) return [];
  if (!hasToken()) return [];
  const j = await tmdb(`/search/person?include_adult=false&query=${encodeURIComponent(q)}`);
  const results = Array.isArray(j.results) ? j.results : [];
  const directing = results.filter((r) => r.known_for_department === "Directing");
  const others = results.filter((r) => r.known_for_department !== "Directing");
  return [...directing, ...others].slice(0, 8).map((r) => ({
    id: r.id,
    name: r.name,
    department: r.known_for_department || "",
    knownFor: (r.known_for || [])
      .map((k) => k.title || k.name)
      .filter(Boolean)
      .slice(0, 2)
      .join(", "),
  }));
}

// Fan out `fn` over `items` with a concurrency cap. Preserves index order.
async function batchAll(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// Returns { tmdbId, released, upcoming } where each list contains
// { id, title, date, status, year }. Only feature-length (≥40 min) films
// where the person is the SOLE "Director" credit. "upcoming" includes
// Rumored / Planned / In Production / Post Production titles AND any film
// whose release_date is still in the future. "Canceled" titles are dropped.
// Throws "no-token", "bad-token", "not-found", "tmdb-NNN".
async function fetchFresh(name) {
  const person = await findPerson(name);
  if (!person) throw new Error("not-found");
  const j = await tmdb(`/person/${person.id}/movie_credits`);
  const crew = Array.isArray(j.crew) ? j.crew : [];
  const directing = crew
    .filter((c) => c.job === "Director" && (c.title || c.original_title))
    // Dedupe (TMDB can list a director twice when crewed under multiple jobs).
    .filter((f, idx, arr) => arr.findIndex((g) => g.id === f.id) === idx);

  // Per-film detail call gives runtime AND full crew, which is the only way
  // to verify "sole director" — the credits endpoint above is one row per
  // (person, film) and doesn't tell us whether anyone else co-directed.
  const details = await batchAll(directing, DETAIL_BATCH_SIZE, async (c) => {
    try {
      return await tmdb(`/movie/${c.id}?append_to_response=credits`);
    } catch {
      return null;
    }
  });

  const today = new Date().toISOString().slice(0, 10);
  const released = [];
  const upcoming = [];
  for (let i = 0; i < directing.length; i++) {
    const credit = directing[i];
    const d = details[i];
    if (!d) continue;
    // Reject sub-feature runtimes. Missing/zero runtime is allowed through
    // (usually an unreleased film whose runtime hasn't been added yet).
    if (typeof d.runtime === "number" && d.runtime > 0 && d.runtime < FEATURE_MIN_RUNTIME) continue;
    // Sole-director check: count Director-job entries on this film's crew.
    const directors = (d.credits?.crew || []).filter((c) => c.job === "Director");
    if (directors.length > 1) continue;
    const status = d.status || "";
    if (status === "Canceled") continue;

    const date = credit.release_date || d.release_date || "";
    // TMDB returns a `year` only via release_date; many rumored projects have
    // no date at all, in which case we leave year empty and the UI shows TBD.
    const year = date ? date.slice(0, 4) : "";
    const film = {
      id: credit.id,
      title: credit.title || credit.original_title || "",
      date,
      year,
      status,
    };
    const isReleased = status === "Released" && date && date <= today;
    if (isReleased) released.push(film);
    else upcoming.push(film);
  }
  released.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  // Upcoming: ascending by date so the soonest releases land first. Films
  // with no date sort to the end (placeholder "9999-12-31").
  upcoming.sort((a, b) => (a.date || "9999-12-31").localeCompare(b.date || "9999-12-31"));
  return { tmdbId: person.id, released, upcoming };
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
        writeCache(name, res);
        return {
          fetchedAt: new Date().toISOString(),
          tmdbId: res.tmdbId,
          released: res.released,
          upcoming: res.upcoming,
        };
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
