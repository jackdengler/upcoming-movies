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

// ---------- Box Office Mojo: authoritative wide-release list ----------
// BOM is the user's canonical source for "this is a real wide release."
// We scrape the weekly calendar pages covering the target month and pull out
// any film whose release-type annotation reads "Wide". Result is used to
// force-include that title regardless of TMDB popularity.
//
// Notes:
// - BOM has no public API; we scrape public HTML. If Amazon's WAF rejects a
//   request we skip that week and continue; missing hits fall back to TMDB's
//   own wide classification so the script never hard-fails.
// - The HTML shape has been stable (a single <table> per Friday with a
//   "Release" / release-type cell), but is not contractual. If parsing yields
//   zero hits the surrounding logic still runs.

const BOM_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0";

const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
const decodeEntities = (s) =>
  s
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, ent) => {
      if (ent[0] === "#") {
        const code = ent[1] === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      }
      return HTML_ENTITIES[ent.toLowerCase()] ?? _;
    });

const stripTags = (s) => decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

const normalizeTitle = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function fridaysCoveringMonth(y, m) {
  // m is 1-indexed. Return every Friday whose week (Fri..Thu) intersects the month.
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  // Walk back to the Friday on or before the 1st.
  const offset = (first.getUTCDay() - 5 + 7) % 7;
  const cursor = new Date(first);
  cursor.setUTCDate(cursor.getUTCDate() - offset);
  const out = [];
  while (cursor <= last) {
    out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}

async function fetchBomHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": BOM_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!r.ok) throw new Error(`BOM ${r.status}`);
  return r.text();
}

// Distributors whose films we always pull, even when they only distribute
// (rather than produce) and even when the release is limited. Checked as a
// case-insensitive whole-word match against each BOM row's text.
const ALWAYS_PULL_DISTRIBUTORS = ["Neon"];

// Parse every BOM row that links to a film. Returns { title, rowText } so the
// caller can inspect release-type and distributor keywords independently.
function parseBomRows(html) {
  const out = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(html))) {
    const cells = row[1];
    const link = cells.match(
      /<a[^>]+href="\/(?:release|title)\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i
    );
    if (!link) continue;
    const title = stripTags(link[1]);
    if (!title) continue;
    out.push({ title, rowText: stripTags(cells) });
  }
  return out;
}

async function fetchBomSignals(y, m) {
  const wide = new Set();
  const always = new Set();
  const fridays = fridaysCoveringMonth(y, m);
  for (const f of fridays) {
    const ymd = f.toISOString().slice(0, 10);
    try {
      const html = await fetchBomHtml(`https://www.boxofficemojo.com/calendar/${ymd}/`);
      for (const { title, rowText } of parseBomRows(html)) {
        const norm = normalizeTitle(title);
        if (/\bWide\b/.test(rowText) && !/\bLimited\b/.test(rowText)) wide.add(norm);
        if (
          ALWAYS_PULL_DISTRIBUTORS.some((k) =>
            new RegExp(`\\b${k}\\b`, "i").test(rowText)
          )
        ) {
          always.add(norm);
        }
      }
      await sleep(300);
    } catch (e) {
      console.warn(`BOM ${ymd}: ${e.message}`);
    }
  }
  return { wide, always };
}

let bomWideTitles = new Set();
let bomAlwaysTitles = new Set();
try {
  ({ wide: bomWideTitles, always: bomAlwaysTitles } = await fetchBomSignals(+year, +mm));
  console.log(
    `BOM: ${bomWideTitles.size} wide, ${bomAlwaysTitles.size} always-pull distributor match(es) for ${MONTH}`
  );
} catch (e) {
  console.warn(`BOM lookup failed entirely: ${e.message}`);
}

const bomForceTitles = new Set([...bomWideTitles, ...bomAlwaysTitles]);

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

// For any BOM force-pull title (wide release or always-pull distributor) not
// already in TMDB's discover results, search TMDB by title and add the best
// match so we render it even when popularity is below the floor.
for (const norm of bomForceTitles) {
  if (list.some((m) => normalizeTitle(m.title) === norm)) continue;
  try {
    const r = await get(
      `/search/movie?query=${encodeURIComponent(norm)}&primary_release_year=${year}`
    );
    const hits = r.results || [];
    const hit =
      hits.find((x) => (x.release_date || "").slice(0, 7) === MONTH) || hits[0];
    if (hit && !list.some((m) => m.id === hit.id)) list.push(hit);
    await sleep(35);
  } catch (e) {
    console.warn(`BOM→TMDB search "${norm}" failed:`, e.message);
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

    const normTitle = normalizeTitle(d.title);
    const isBomWide = bomWideTitles.has(normTitle);
    const isBomAlways = bomAlwaysTitles.has(normTitle);
    // Only trust BOM for "wide". TMDB's cls.type === "wide" comes from
    // release type 3 (Theatrical) which it assigns to virtually every
    // theatrical release, including 1-theater festival premieres, so it
    // can't be used as a popularity-floor bypass on its own.
    const isWide = isBomWide;

    if (!date) continue;
    if (date.slice(0, 7) !== MONTH) continue;

    // BOM-confirmed films are inherently theatrical (BOM only lists theatrical
    // releases), so trust that signal even if TMDB's classify() came up short.
    if (!isForced && !isBomAlways && !isBomWide && !isTheatrical) continue;

    const major = hasMajorStudio(d.production_companies);
    const pop = m.popularity || d.popularity || 0;

    // Forced, majors, wide releases, and always-pull distributor matches
    // bypass the popularity floor.
    if (!isForced && !major && !isWide && !isBomAlways && pop < MIN_POPULARITY_NON_MAJOR) continue;

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
      _bom_always: isBomAlways,
    });
    await sleep(35);
  } catch (e) {
    console.warn(`skip ${m.id} ${m.title}: ${e.message}`);
  }
}

// Always keep every major-studio release, every force-included film, every
// wide theatrical release, and every always-pull distributor match (e.g.
// Neon). Fill remaining budget with top-popularity others.
const keep = releases.filter((r) => r._major || r._forced || r._wide || r._bom_always);
const others = releases.filter((r) => !r._major && !r._forced && !r._wide && !r._bom_always);
others.sort((a, b) => b._pop - a._pop);
const remaining = Math.max(0, MAX_PER_MONTH - keep.length);
const chosen = [...keep, ...others.slice(0, remaining)];
chosen.sort(
  (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)
);
for (const r of chosen) {
  delete r._pop;
  delete r._major;
  delete r._forced;
  delete r._wide;
  delete r._bom_always;
}
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
