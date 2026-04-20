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
const MIN_POPULARITY_LIMITED = 4;

// Major studios / distributors — if a movie has one of these in production_companies,
// it's guaranteed to be included regardless of popularity or the monthly cap.
const MAJOR_STUDIOS = new Set([
  // Disney
  "Walt Disney Pictures", "Walt Disney Studios Motion Pictures",
  "Marvel Studios", "Lucasfilm Ltd.", "Lucasfilm", "Pixar", "Pixar Animation Studios",
  "20th Century Studios", "Searchlight Pictures",
  // Warner
  "Warner Bros. Pictures", "Warner Bros.", "New Line Cinema", "DC Studios", "DC Entertainment",
  // Universal / Focus
  "Universal Pictures", "Focus Features", "Working Title Films",
  "DreamWorks Animation", "DreamWorks Pictures",
  "Illumination", "Illumination Entertainment",
  // Sony
  "Sony Pictures", "Sony Pictures Entertainment", "Columbia Pictures", "TriStar Pictures",
  "Screen Gems", "Sony Pictures Classics", "Sony Pictures Animation",
  // Paramount
  "Paramount Pictures", "Paramount Animation", "Paramount Players",
  // Lionsgate & specialty
  "Lionsgate", "Summit Entertainment",
  "A24",
  "Neon",
  "IFC Films",
  "Bleecker Street",
  // Streamers / majors
  "Apple Studios", "Apple Original Films",
  "Amazon MGM Studios", "MGM", "Metro-Goldwyn-Mayer", "United Artists",
  "Netflix",
  // Notable genre labels
  "Blumhouse Productions", "Blumhouse",
  "Miramax",
  "STX Entertainment", "STXfilms",
  "Orion Pictures",
  "Skydance", "Skydance Media", "Skydance Animation",
  "Atomic Monster",
  "Plan B Entertainment",
  "Annapurna Pictures",
  "Black Bear Pictures",
  "Magnolia Pictures",
  "Roadside Attractions",
]);

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
      "primary_release_date.gte": start,
      "primary_release_date.lte": end,
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
  (companies || []).some((c) => MAJOR_STUDIOS.has(c.name));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await discover();
const releases = [];
for (const m of list) {
  try {
    const d = await get(`/movie/${m.id}?append_to_response=credits,release_dates`);
    if (d.original_language && d.original_language !== "en") continue;
    const genreIds = (d.genres || []).map((g) => g.id);
    if (genreIds.includes(99) || genreIds.includes(10402)) continue;

    const cls = classify(d.release_dates);
    if (!cls.date) continue;
    if (cls.date.slice(0, 7) !== MONTH) continue;

    // Must have an actual US theatrical release (wide or limited).
    if (!cls.isTheatrical) continue;

    const major = hasMajorStudio(d.production_companies);
    const pop = m.popularity || d.popularity || 0;

    // Wide releases always pass (they hit AMC in LA by default).
    // Limited releases need a major studio or a bit of popularity so we skip
    // unknown one-theater art-house micro-releases.
    if (cls.type !== "wide" && !major && pop < MIN_POPULARITY_LIMITED) continue;

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
    const studio = (d.production_companies || [])[0]?.name || "—";

    releases.push({
      tmdb_id: d.id,
      date: cls.date,
      title: d.title,
      director,
      studio,
      budget_usd: d.budget || null,
      release_type: cls.type,
      genre: (d.genres || []).map((g) => g.name).join(" / ") || "—",
      cast,
      notes: d.tagline || "",
      _pop: d.popularity || 0,
      _major: major,
    });
    await sleep(35);
  } catch (e) {
    console.warn(`skip ${m.id} ${m.title}: ${e.message}`);
  }
}

// Always keep every major-studio release. Fill remaining budget with top-popularity others.
const majors = releases.filter((r) => r._major);
const others = releases.filter((r) => !r._major);
others.sort((a, b) => b._pop - a._pop);
const remaining = Math.max(0, MAX_PER_MONTH - majors.length);
const chosen = [...majors, ...others.slice(0, remaining)];
chosen.sort(
  (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)
);
for (const r of chosen) { delete r._pop; delete r._major; }
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
  `${changed ? "Updated" : "Unchanged"} ${filename} (${finalReleases.length} releases, ${majors.length} major)`
);
