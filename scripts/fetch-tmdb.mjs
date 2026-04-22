#!/usr/bin/env node
// Fetches release data from TMDB and writes data/<month>-<year>.json.
// Env: TMDB_TOKEN (v4 Read Access Token), MONTH (YYYY-MM, defaults to current month)

import { writeFileSync, mkdirSync, readFileSync } from "fs";

const TOKEN = process.env.TMDB_TOKEN;
if (!TOKEN) {
  console.error("TMDB_TOKEN missing. Add it as a repo secret.");
  process.exit(1);
}

const now = new Date();
const MONTH =
  process.env.MONTH ||
  `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
const [year, mm] = MONTH.split("-");
const start = `${year}-${mm}-01`;
const end = new Date(Date.UTC(+year, +mm, 0)).toISOString().slice(0, 10);

const API = "https://api.themoviedb.org/3";
const headers = { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" };

const MAX_PER_MONTH = 75;
const DISCOVER_PAGES = 10;
const MIN_POPULARITY_NON_MAJOR = 6;

// Films that MUST be included, with manual date/type fallbacks for when TMDB's
// data is incomplete. Every field except imdb_id is optional and only used when
// TMDB doesn't supply it.
const FORCE_INCLUDE = [
  {
    imdb_id: "tt11378946",
    date: "2026-04-24",
    release_type: "wide",
    studio: "Lionsgate",
    // director/cast/etc pulled live from TMDB via the normal detail fetch
  },
  {
    imdb_id: "tt34685692",
    date: "2026-04-24",
    release_type: "wide",
    studio: "Independent Film Company",
  },
];

// Major studio / distributor name fragments (lowercase, substring match).
// If a production company name contains any of these, the film is treated as major.
const MAJOR_STUDIO_KEYWORDS = [
  "walt disney", "marvel studios", "lucasfilm", "pixar",
  "20th century", "searchlight",
  "warner bros", "new line", "dc studios", "dc entertainment",
  "universal pictures", "focus features", "working title", "dreamworks", "illumination",
  "sony pictures", "columbia pictures", "tristar", "screen gems",
  "paramount",
  "lionsgate", "lions gate", "summit entertainment",
  "a24",
  "neon",
  "ifc films", "bleecker street",
  "apple studios", "apple original",
  "amazon mgm", "metro-goldwyn", "united artists",
  "netflix",
  "blumhouse",
  "miramax",
  "stx entertainment", "stxfilms",
  "orion pictures",
  "skydance",
  "atomic monster",
  "plan b entertainment",
  "annapurna",
  "black bear",
  "magnolia pictures",
  "roadside attractions",
  "wonder project",
];

async function get(path) {
  const r = await fetch(`${API}${path}`, { headers });
  if (!r.ok) throw new Error(`TMDB ${r.status} ${path}`);
  return r.json();
}

async function discover() {
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= DISCOVER_PAGES; page++) {
    const q = new URLSearchParams({
      region: "US",
      with_release_type: "2|3",
      without_genres: "99,10402",
      with_original_language: "en",
      "release_date.gte": start,
      "release_date.lte": end,
      sort_by: "popularity.desc",
      page: String(page),
    });
    const j = await get(`/discover/movie?${q}`);
    for (const r of j.results || []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    if (page >= (j.total_pages || 1)) break;
  }
  return out;
}

function classify(releaseDates) {
  const us = (releaseDates?.results || []).find((r) => r.iso_3166_1 === "US");
  if (!us) return { type: "wide", date: null, isTheatrical: false };
  const entries = [...us.release_dates]
    .filter((r) => [2, 3, 4, 6].includes(r.type))
    .sort((a, b) => a.release_date.localeCompare(b.release_date));
  const first = entries[0];
  if (!first) return { type: "wide", date: null, isTheatrical: false };
  const hasWide = entries.some((e) => e.type === 3);
  const isTheatrical = entries.some((e) => e.type === 2 || e.type === 3);
  const type = hasWide
    ? "wide"
    : first.type === 2
    ? "limited"
    : first.type === 4 || first.type === 6
    ? "streaming"
    : "wide";
  return { type, date: first.release_date.slice(0, 10), isTheatrical };
}

const hasMajorStudio = (companies) =>
  (companies || []).some((c) => {
    const name = (c.name || "").toLowerCase();
    return MAJOR_STUDIO_KEYWORDS.some((kw) => name.includes(kw));
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await discover();
const forced = new Map(); // tmdb id -> force-include meta

// Force-include targeted films by IMDb ID (bypasses discover's ranking).
for (const entry of FORCE_INCLUDE) {
  try {
    const r = await get(`/find/${entry.imdb_id}?external_source=imdb_id`);
    const movie = r.movie_results?.[0];
    if (movie) {
      forced.set(movie.id, entry);
      if (!list.some((m) => m.id === movie.id)) list.push(movie);
    } else {
      console.warn(`force-include ${entry.imdb_id}: no TMDB match`);
    }
  } catch (e) {
    console.warn(`force-include ${entry.imdb_id} failed:`, e.message);
  }
}

const releases = [];
for (const m of list) {
  try {
    const d = await get(`/movie/${m.id}?append_to_response=credits,release_dates`);
    const isForced = forced.has(d.id);
    const forcedMeta = forced.get(d.id);

    if (!isForced) {
      if (d.original_language && d.original_language !== "en") continue;
      const genreIds = (d.genres || []).map((g) => g.id);
      if (genreIds.includes(99) || genreIds.includes(10402)) continue;
    }

    const cls = classify(d.release_dates);
    // For forced films, trust the manual override if TMDB has nothing / wrong date.
    const date = (isForced && forcedMeta?.date) ? forcedMeta.date : cls.date;
    const releaseType = cls.type && cls.date ? cls.type : (forcedMeta?.release_type || "wide");
    const isTheatrical = cls.isTheatrical || (isForced && forcedMeta?.release_type);

    if (!date) continue;
    if (date.slice(0, 7) !== MONTH) continue;

    if (!isForced && !isTheatrical) continue;

    const major = hasMajorStudio(d.production_companies);
    const pop = m.popularity || d.popularity || 0;

    // Forced, majors, and any wide theatrical release bypass the popularity
    // floor — per user preference, every wide release should always pull.
    const isWide = cls.type === "wide";
    if (!isForced && !major && !isWide && pop < MIN_POPULARITY_NON_MAJOR) continue;

    const director =
      (d.credits?.crew || [])
        .filter((c) => c.job === "Director")
        .map((c) => c.name)
        .join(", ") || "—";
    const cast =
      (d.credits?.cast || [])
        .slice(0, 4)
        .map((c) => c.name)
        .join(", ") || "—";
    const studio = (d.production_companies || [])[0]?.name || forcedMeta?.studio || "—";

    releases.push({
      tmdb_id: d.id,
      date,
      title: d.title,
      director,
      studio,
      budget_usd: d.budget || null,
      release_type: releaseType,
      genre: (d.genres || []).map((g) => g.name).join(" / ") || "—",
      cast,
      notes: d.tagline || "",
      _pop: d.popularity || 0,
      _major: major,
      _forced: isForced,
      _wide: isWide,
    });
    await sleep(35);
  } catch (e) {
    console.warn(`skip ${m.id} ${m.title}: ${e.message}`);
  }
}

// Always keep every major-studio release, every force-included film, and
// every wide theatrical release. Fill remaining budget with top-popularity
// others.
const keep = releases.filter((r) => r._major || r._forced || r._wide);
const others = releases.filter((r) => !r._major && !r._forced && !r._wide);
others.sort((a, b) => b._pop - a._pop);
const remaining = Math.max(0, MAX_PER_MONTH - keep.length);
const chosen = [...keep, ...others.slice(0, remaining)];
chosen.sort(
  (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)
);
for (const r of chosen) { delete r._pop; delete r._major; delete r._forced; delete r._wide; }
const finalReleases = chosen;

const monthName = new Date(`${start}T12:00:00Z`).toLocaleString("en-US", {
  month: "long",
});
const out = {
  month: `${monthName} ${year}`,
  updated: new Date().toISOString().slice(0, 10),
  source: "TMDB",
  releases: finalReleases,
};

mkdirSync("data", { recursive: true });
const filename = `data/${monthName.toLowerCase()}-${year}.json`;
const payload = JSON.stringify(out, null, 2) + "\n";

let changed = true;
try {
  changed = readFileSync(filename, "utf8") !== payload;
} catch {}
writeFileSync(filename, payload);
console.log(
  `${changed ? "Updated" : "Unchanged"} ${filename} (${finalReleases.length} releases, ${keep.length} always-kept)`
);
