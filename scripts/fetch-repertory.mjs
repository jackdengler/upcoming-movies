#!/usr/bin/env node
// Scrapes LA repertory cinemas (New Beverly, Nuart, Aero, Egyptian, Vista,
// Los Feliz 3, Alamo Drafthouse DTLA, Academy Museum, Brain Dead Studios,
// Lumiere Music Hall, AMC Classics @ select LA-area AMCs) into
// data/repertory.json.
//
// Per-source failures are logged but do NOT abort the run; if a source fails,
// the previous run's screenings for its theaters are preserved so the UI
// degrades gracefully instead of going blank.
//
// No env vars required. Runs untouched in CI; safe to run locally.

import { writeFileSync, mkdirSync, readFileSync } from "fs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0";

const COMMON_HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const HORIZON_DAYS = 60; // keep screenings up to ~2 months out
const REQUEST_TIMEOUT_MS = 15000;

// Diagnostic sample capture. When a source returns HTTP 200 but 0 events, we
// attach a ~60KB sample of its last fetched page to the committed JSON so
// parser bugs are debuggable without live access to the target sites.
const _debug = {
  currentSource: null,
  sampleBySource: new Map(), // sourceId -> { url, bytes, sample }
};

// ---------- Theater registry ----------

const THEATERS = [
  { slug: "new-beverly", name: "New Beverly Cinema", address: "7165 W Beverly Blvd, Los Angeles", url: "https://thenewbev.com/" },
  { slug: "nuart", name: "Nuart Theatre", address: "11272 Santa Monica Blvd, Los Angeles", url: "https://www.landmarktheatres.com/los-angeles/nuart-theatre" },
  { slug: "aero", name: "Aero Theatre", address: "1328 Montana Ave, Santa Monica", url: "https://www.americancinematheque.com/aero/" },
  { slug: "egyptian", name: "Egyptian Theatre", address: "6712 Hollywood Blvd, Los Angeles", url: "https://www.americancinematheque.com/egyptian/" },
  { slug: "los-feliz-theatre", name: "Los Feliz Theatre", address: "1822 N Vermont Ave, Los Angeles", url: "https://www.americancinematheque.com/about/theatres/los-feliz-theatre/" },
  { slug: "vista", name: "Vista Theater", address: "4473 Sunset Dr, Los Angeles", url: "https://vistatheaterhollywood.com/" },
  { slug: "alamo-dtla", name: "Alamo Drafthouse DTLA", address: "700 W 7th St, Los Angeles", url: "https://drafthouse.com/los-angeles" },
  { slug: "academy-museum", name: "Academy Museum", address: "6067 Wilshire Blvd, Los Angeles", url: "https://www.academymuseum.org/en/programs" },
  { slug: "brain-dead", name: "Brain Dead Studios", address: "611 N Fairfax Ave, Los Angeles", url: "https://studios.wearebraindead.com/coming-soon/" },
];

// First-run AMC venues the user favorites that are NOT Fathom partners, so
// they need a separate pull from AMC's own REST API. Screenings tagged with
// the `fanfaves` attribute (AMC's Fan Faves rerelease program) become
// repertory rows; everything else is first-run programming whose titles we
// collect into AMC_LOCAL_TITLES so the New Releases view can offer an
// "Only at my AMCs" filter. theatreId values come from AMC's API and appear
// in the ReactServer payload on any theatre showtimes page.
// Normalized titles of first-run films currently scheduled at any of the
// AMC_PREFERRED_THEATERS within HORIZON_DAYS. Populated as a side effect of
// scrapeAmcPreferredTheatres and emitted as `amc_local_titles` so the client
// can match against `slugifyClient(release.title)` to power a soft filter.
// On a failed/skipped AMC pull this stays empty and is preserved from the
// previous run below — same degrade-gracefully behaviour as repertory rows.
const AMC_LOCAL_TITLES = new Set();

const AMC_PREFERRED_THEATERS = [
  { slug: "amc-century-city-15", theatreId: 245, name: "AMC Century City 15", address: "10250 Santa Monica Blvd, Los Angeles", url: "https://www.amctheatres.com/movie-theatres/los-angeles/amc-century-city-15" },
  { slug: "amc-dine-in-marina-6", theatreId: 2418, name: "AMC DINE-IN Marina 6", address: "13455 Maxella Ave, Marina Del Rey", url: "https://www.amctheatres.com/movie-theatres/los-angeles/amc-dine-in-marina-6" },
  { slug: "amc-marina-marketplace-6", theatreId: 446, name: "AMC Marina Marketplace 6", address: "4335 Glencoe Ave, Marina Del Rey", url: "https://www.amctheatres.com/movie-theatres/los-angeles/amc-marina-marketplace-6" },
  { slug: "amc-the-grove-14", theatreId: 450, name: "AMC The Grove 14", address: "189 The Grove Dr, Los Angeles", url: "https://www.amctheatres.com/movie-theatres/los-angeles/amc-the-grove-14" },
  { slug: "amc-santa-monica-7", theatreId: 203, name: "AMC Santa Monica 7", address: "1310 3rd Street, Santa Monica", url: "https://www.amctheatres.com/movie-theatres/los-angeles/amc-santa-monica-7" },
  { slug: "amc-burbank-town-center-8", theatreId: 209, name: "AMC Burbank Town Center 8", address: "201 E Magnolia Blvd, Burbank", url: "https://www.amctheatres.com/movie-theatres/los-angeles/amc-burbank-town-center-8" },
];

// Fathom's specific LA venues (AMC Burbank, Regal LA Live, etc.) are
// discovered dynamically by scrapeFathomEvents at run time and pushed onto
// THEATERS as they're seen, so the static registry above doesn't need
// stubs for them. Theater slugs are of the form `fathom-<theaterID>` where
// theaterID is Fathom's internal venue id.
//
// Fathom's showtimes API returns the 25 nearest partner cinemas for each
// event — 30+ chain venues, most of them far-flung. Narrow the cast here so
// only the handful we actually care about get registered and emit screenings.
// Keys are Fathom theater IDs; values are comments for human readers.
const FATHOM_THEATER_ALLOWLIST = new Set([
  "17364", // Universal Cinema AMC at CityWalk Hollywood
  "18736", // AMC Burbank 16
  "17327", // AMC South Bay Galleria 16
]);

// ---------- Generic helpers ----------

const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
const decodeEntities = (s) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, ent) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    }
    return HTML_ENTITIES[ent.toLowerCase()] ?? _;
  });

const stripTags = (s) =>
  decodeEntities(String(s).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

// Mirror of slugifyClient in app.js — must stay in sync so amc_local_titles
// keys match what the frontend computes from release.title.
const slugifyTitle = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

async function fetchText(url, extraHeaders = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { ...COMMON_HEADERS, ...extraHeaders },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    const text = await r.text();
    // Record a sample for the currently-running source so we can diagnose
    // "HTTP 200 but 0 events" cases (wrong parser) from the committed JSON.
    if (_debug.currentSource) {
      _debug.sampleBySource.set(_debug.currentSource, {
        url,
        bytes: text.length,
        sample: text.slice(0, 60000),
      });
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, extraHeaders = {}) {
  const text = await fetchText(url, { Accept: "application/json", ...extraHeaders });
  return JSON.parse(text);
}

// ---------- TMDB trailer lookup (rep entries) ----------

const TMDB_API = "https://api.themoviedb.org/3";

async function tmdbGet(path) {
  const token = process.env.TMDB_TOKEN;
  if (!token) throw new Error("TMDB_TOKEN missing");
  const r = await fetch(`${TMDB_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`TMDB ${r.status} ${path}`);
  return r.json();
}

function pickTrailerKey(videos) {
  const yt = (videos?.results || []).filter(
    (v) => v.site === "YouTube" && v.key,
  );
  if (!yt.length) return null;
  const score = (v) =>
    (v.type === "Trailer" ? 1000 : v.type === "Teaser" ? 500 : 0) +
    (v.official ? 100 : 0);
  yt.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sb - sa;
    return (b.published_at || "").localeCompare(a.published_at || "");
  });
  return yt[0].key;
}

// Look up a YouTube trailer key by (title, year). Best-effort: returns null
// on any miss (no result, no videos, no English-language match) so callers
// can fall back to YouTube search. Caches by `${title}|${year}` so the same
// film across many showtimes incurs at most two TMDB calls.
const _trailerCache = new Map();
async function lookupTrailerKey(title, year) {
  const cacheKey = `${title}|${year ?? ""}`;
  if (_trailerCache.has(cacheKey)) return _trailerCache.get(cacheKey);
  let result = null;
  try {
    const params = new URLSearchParams({
      query: title,
      include_adult: "false",
    });
    if (year) params.set("year", String(year));
    const search = await tmdbGet(`/search/movie?${params.toString()}`);
    const candidates = search.results || [];
    const match = candidates.find((m) => {
      const my = (m.release_date || "").slice(0, 4);
      return year ? my === String(year) : true;
    }) || candidates[0];
    if (match?.id) {
      await sleep(35);
      const videos = await tmdbGet(`/movie/${match.id}/videos`);
      result = pickTrailerKey(videos);
    }
  } catch (e) {
    console.warn(`Trailer lookup failed for "${title}" (${year || "?"}): ${e.message}`);
  }
  _trailerCache.set(cacheKey, result);
  await sleep(35);
  return result;
}

async function enrichTrailers(screenings) {
  if (!process.env.TMDB_TOKEN) {
    console.log("TMDB_TOKEN not set; skipping trailer enrichment.");
    return;
  }
  const uniq = new Map(); // "title|year" -> { title, year }
  for (const s of screenings) {
    const k = `${s.title}|${s.year ?? ""}`;
    if (!uniq.has(k)) uniq.set(k, { title: s.title, year: s.year ?? null });
  }
  console.log(`TMDB trailer lookup: ${uniq.size} unique film(s).`);
  const resolved = new Map();
  for (const [k, { title, year }] of uniq) {
    resolved.set(k, await lookupTrailerKey(title, year));
  }
  let hits = 0;
  for (const s of screenings) {
    const k = `${s.title}|${s.year ?? ""}`;
    const id = resolved.get(k);
    if (id) {
      s.youtube_trailer_id = id;
      hits++;
    }
  }
  console.log(`Trailer enrichment: ${hits}/${screenings.length} screenings tagged.`);
}

// LA local-time formatting. All sources differ in how they encode time zones
// (some emit naive datetimes that are already PT, some emit UTC). We normalize
// to LA wall time using Intl, which handles DST correctly.
function laParts(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// For naive datetimes that are already PT (e.g. "2026-04-25 19:30") — bypass
// timezone conversion entirely. Returns { date, time } or null.
function naivePTParts(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

const TODAY_LA = laParts(new Date()).date;
const HORIZON_LA = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + HORIZON_DAYS);
  return laParts(d).date;
})();

const inWindow = (date) => date >= TODAY_LA && date <= HORIZON_LA;

// JSON-LD blocks embedded in WordPress / Next.js pages.
function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim().replace(/^[\s﻿]+|[\s﻿]+$/g, "");
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Some sites emit slightly malformed JSON-LD with trailing commas; skip.
    }
  }
  return out;
}

// Walk JSON-LD and return every Event-like node.
function flattenEvents(node, out = []) {
  if (Array.isArray(node)) {
    for (const x of node) flattenEvents(x, out);
  } else if (node && typeof node === "object") {
    if (Array.isArray(node["@graph"])) flattenEvents(node["@graph"], out);
    const t = node["@type"];
    const isEvent =
      (typeof t === "string" && /Event|ScreeningEvent/i.test(t)) ||
      (Array.isArray(t) && t.some((x) => /Event|ScreeningEvent/i.test(String(x))));
    if (isEvent) out.push(node);
    for (const k of Object.keys(node)) {
      if (k === "@graph") continue;
      const v = node[k];
      if (v && typeof v === "object") flattenEvents(v, out);
    }
  }
  return out;
}

// Minimal ICS VEVENT parser. Handles line-folding (RFC 5545).
function parseIcs(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const events = [];
  const re = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let m;
  while ((m = re.exec(unfolded))) {
    const ev = {};
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const keyRaw = line.slice(0, i);
      const value = line.slice(i + 1);
      const key = keyRaw.split(";")[0].toUpperCase();
      ev[key] = value;
    }
    if (ev.SUMMARY && ev.DTSTART) events.push(ev);
  }
  return events;
}

// "20260425T193000" or "20260425T013000Z" → ISO-ish input for laParts/naivePTParts.
function icsTimeToParts(dtstart) {
  const m = String(dtstart).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", , isUtc] = m;
  if (isUtc) {
    return laParts(`${y}-${mo}-${d}T${h}:${mi}:00Z`);
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

const FORMAT_HINTS = ["35mm", "70mm", "imax", "dcp", "16mm"];
function detectFormat(text) {
  const lower = String(text || "").toLowerCase();
  for (const f of FORMAT_HINTS) if (lower.includes(f)) return f === "imax" ? "IMAX" : f;
  return null;
}

// Strip year suffixes / format suffixes from titles ("The Thing (1982) — 35mm" → "The Thing").
function cleanTitle(s) {
  return stripTags(s)
    .replace(/\s*\(\d{4}\)\s*/g, " ")
    .replace(/\s+[-–—]\s+(35|70|16)mm.*$/i, "")
    .replace(/\s+[-–—]\s+(IMAX|DCP).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractYear(s) {
  const m = String(s).match(/\((\d{4})\)/);
  return m ? Number(m[1]) : null;
}

// ---------- Per-theater scrapers ----------
//
// Each scraper returns an array of screenings (possibly empty). A throw is
// caught at the top level and logged; the previous run's data for that source's
// theaters is preserved.
//
// Screening shape:
//   { theater, title, year, date, time, format, series, url }

// "7:30 pm" → "19:30"
function parse12h(s) {
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})\s*([ap])m$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "p") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

const MONTH_BY_NAME = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

// New Beverly publishes one month at a time on /schedule/ as server-rendered
// `<article class="event-card">` blocks. The page heading "<h2>Month YYYY</h2>"
// supplies the year context; each card carries day, times, title, and a
// program URL. Multi-feature nights have N <time> tags + N titles separated by
// " / " inside the title heading.
async function scrapeNewBeverly() {
  const url = "https://thenewbev.com/schedule/";
  const html = await fetchText(url);

  const headingM = html.match(/<h2[^>]*>\s*([A-Za-z]+)\s+(\d{4})\s*<\/h2>/);
  const headingMonth = headingM ? headingM[1].toLowerCase() : null;
  const headingYear = headingM ? Number(headingM[2]) : new Date().getUTCFullYear();

  const out = [];
  const articleRe = /<article[^>]*class="[^"]*\bevent-card\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = articleRe.exec(html))) {
    const block = match[1];

    const dayM = block.match(/event-card__numb[^>]*>\s*(\d{1,2})\s*</);
    if (!dayM) continue;
    const monthM = block.match(/event-card__month[^>]*>\s*([A-Za-z]+)\s*</);
    const monthName = (monthM ? monthM[1] : headingMonth || "").toLowerCase();
    const monthNum = MONTH_BY_NAME[monthName];
    if (!monthNum) continue;

    // Year roll-over: if the heading is December and a card shows a January
    // day, that day is in the following calendar year.
    let year = headingYear;
    if (headingMonth && monthName !== headingMonth &&
        MONTH_BY_NAME[headingMonth] === 12 && monthNum === 1) {
      year += 1;
    }
    const day = Number(dayM[1]);
    const date = `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!inWindow(date)) continue;

    const times = [];
    const timeRe = /<time[^>]*class="[^"]*\bevent-card__time\b[^"]*"[^>]*>\s*([0-9:]+\s*[ap]m)\s*<\/time>/gi;
    let tm;
    while ((tm = timeRe.exec(block))) {
      const t = parse12h(tm[1]);
      if (t) times.push(t);
    }
    if (!times.length) continue;

    const titleM = block.match(/<h4[^>]*class="[^"]*\bevent-card__title\b[^"]*"[^>]*>([\s\S]*?)<\/h4>/i);
    const titleText = titleM ? stripTags(titleM[1]).replace(/\s+/g, " ").trim() : "";
    const titles = titleText.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
    if (!titles.length) continue;

    const hrefM = block.match(/href="([^"]+)"/);
    const programUrl = hrefM ? hrefM[1] : url;

    const seriesM = block.match(/event-card__label[^>]+aria-label="([^"]+)"/);
    const series = seriesM ? decodeEntities(seriesM[1]) : null;

    // Pair each <time> with its corresponding title for double/triple features.
    // On a count mismatch (rare), emit one screening per time using the joined
    // title — better to over-report than to drop the row entirely.
    const pairs = times.length === titles.length
      ? times.map((t, i) => [t, titles[i]])
      : times.map((t) => [t, titles.join(" / ")]);

    for (const [time, rawTitle] of pairs) {
      out.push({
        theater: "new-beverly",
        title: cleanTitle(rawTitle),
        year: extractYear(rawTitle),
        date,
        time,
        format: detectFormat(rawTitle),
        series,
        url: programUrl,
      });
    }
  }
  return out;
}

// Generic JSON-LD extractor used by several WordPress-backed cinema sites.
function jsonLdEvents(html, theaterSlug, fallbackUrl) {
  const out = [];
  const blocks = extractJsonLd(html);
  for (const b of blocks) {
    for (const ev of flattenEvents(b)) {
      const start = ev.startDate || ev.start_date;
      if (!start) continue;
      const parts = String(start).endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(String(start))
        ? laParts(start)
        : (naivePTParts(start) || laParts(start));
      if (!parts || !inWindow(parts.date)) continue;
      const name = ev.name || ev.headline || "";
      out.push({
        theater: theaterSlug,
        title: cleanTitle(name),
        year: extractYear(name) || (ev.workPresented?.dateCreated ? Number(String(ev.workPresented.dateCreated).slice(0, 4)) : null),
        date: parts.date,
        time: parts.time,
        format: detectFormat(name + " " + (ev.description || "")),
        series: ev.superEvent?.name || null,
        url: ev.url || fallbackUrl,
      });
    }
  }
  return out;
}

// American Cinematheque (Aero + Egyptian + Los Feliz Theatre). The site's
// events listing is Algolia-backed via a custom WP REST endpoint:
//   /wp-json/wp/v2/algolia_get_events?environment=production_2026
//                                    &startDate=<unix>&endDate=<unix>
// Each hit carries event_start_date (YYYYMMDD), event_start_time ("7:00 PM"),
// event_location (array of taxonomy term IDs), and event_card_excerpt (HTML
// like "<p>Los Feliz 3 | …</p>") which we use as a venue-name fallback.
//   54  = Aero Theatre
//   55  = Egyptian Theatre
//   102 = Los Feliz Theatre
// We chunk the request into 30-day windows since the endpoint appears to
// return everything in range without pagination metadata.
async function scrapeAmericanCinematheque() {
  const AC_VENUE_TO_THEATER = { 54: "aero", 55: "egyptian", 102: "los-feliz-theatre" };
  const base = "https://www.americancinematheque.com/wp-json/wp/v2/algolia_get_events";
  const env = `production_${TODAY_LA.slice(0, 4)}`;

  const out = [];
  const seen = new Set();
  // Cover [today-1d, today+HORIZON+1d] in 30-day windows. inWindow() trims
  // anything outside the canonical horizon below.
  const startSec = Math.floor(new Date(`${TODAY_LA}T00:00:00Z`).getTime() / 1000) - 86400;
  const endSec = startSec + (HORIZON_DAYS + 2) * 86400;
  const CHUNK = 30 * 86400;
  for (let s = startSec; s < endSec; s += CHUNK) {
    const e = Math.min(s + CHUNK, endSec);
    const url = `${base}?environment=${env}&startDate=${s}&endDate=${e}`;
    const data = await fetchJson(url);
    const hits = Array.isArray(data?.hits) ? data.hits : [];
    for (const ev of hits) {
      if (ev?.id != null) {
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
      }
      const dm = String(ev?.event_start_date || "").match(/^(\d{4})(\d{2})(\d{2})$/);
      if (!dm) continue;
      const date = `${dm[1]}-${dm[2]}-${dm[3]}`;
      if (!inWindow(date)) continue;
      const time = parse12h(ev.event_start_time || "");
      if (!time) continue;

      let theater = null;
      if (Array.isArray(ev.event_location)) {
        for (const loc of ev.event_location) {
          if (AC_VENUE_TO_THEATER[loc]) { theater = AC_VENUE_TO_THEATER[loc]; break; }
        }
      }
      if (!theater) {
        const vname = String(ev.event_card_excerpt || "")
          .replace(/<[^>]+>/g, " ")
          .toLowerCase();
        if (vname.includes("aero")) theater = "aero";
        else if (vname.includes("egyptian")) theater = "egyptian";
        else if (vname.includes("los feliz")) theater = "los-feliz-theatre";
      }
      if (!theater) continue;

      const name = decodeEntities(ev.title || "");
      const excerptText = decodeEntities(String(ev.event_card_excerpt || "").replace(/<[^>]+>/g, " "));
      const series = Array.isArray(ev.related_series) && ev.related_series[0]?.post_title
        ? decodeEntities(ev.related_series[0].post_title)
        : null;
      out.push({
        theater,
        title: cleanTitle(name),
        year: extractYear(name),
        date,
        time,
        format: detectFormat(`${name} ${excerptText}`),
        series,
        url: ev.url || "https://www.americancinematheque.com/now-showing/",
      });
    }
    await sleep(200);
  }
  return out;
}

// Nuart (Landmark). Landmark is a Gatsby site backed by Webedia's box-office
// API. The theater page triggers these JSON endpoints at page load:
//   /api/gatsby-source-boxofficeapi/schedule?from=...&to=...&theaters={"id":...}
//   /api/gatsby-source-boxofficeapi/scheduledMovies?theaterId=X00CW
// Schedule rows reference movies by numeric ID; scheduledMovies enriches
// those IDs with titles + production years. Theater id "X00CW" comes from
// the `bocms:theater:id` meta tag on the page.
async function scrapeNuart() {
  const THEATER_ID = "X00CW";
  const apiBase = "https://www.landmarktheatres.com/api/gatsby-source-boxofficeapi";

  const endDate = new Date(`${TODAY_LA}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + HORIZON_DAYS);
  const from = `${TODAY_LA}T03:00:00`;
  const to = `${endDate.toISOString().slice(0, 10)}T03:00:00`;
  const theatersJson = JSON.stringify({ id: THEATER_ID, timeZone: "America/Los_Angeles" });

  const scheduleUrl = `${apiBase}/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&theaters=${encodeURIComponent(theatersJson)}`;
  const scheduledUrl = `${apiBase}/scheduledMovies?theaterId=${THEATER_ID}`;

  const [scheduleData, scheduledData] = await Promise.all([
    fetchJson(scheduleUrl).catch(() => null),
    fetchJson(scheduledUrl).catch(() => null),
  ]);

  if (!scheduleData && !scheduledData) {
    throw new Error("nuart: both box-office endpoints unreachable");
  }

  // Build a movieId -> { title, year } map from whichever endpoint carries
  // movie metadata. Walking depth is capped so rogue arrays don't explode.
  const titleById = new Map();
  const collectMeta = (node, depth = 0) => {
    if (depth > 10 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const x of node) collectMeta(x, depth + 1); return; }
    const id = node.id || node.movieId;
    const title = node.title || node.name;
    if (id != null && title) {
      titleById.set(String(id), {
        title: String(title),
        year: node.productionYear || node.year || extractYear(String(title)) || null,
      });
    }
    for (const k of Object.keys(node)) collectMeta(node[k], depth + 1);
  };
  collectMeta(scheduledData);
  collectMeta(scheduleData);

  // The schedule endpoint returns:
  //   { "X00CW": { "schedule": { "<movieId>": { "<YYYY-MM-DD>": [showings] } } } }
  // where each `showing` has `startsAt` (naive PT) and a ticketing URL buried
  // under `data.ticketing[0].urls[0]`. The movieId is the _parent key_ — not
  // a field on the showing — so a generic walker misses it.
  const out = [];
  for (const [_theaterKey, theaterVal] of Object.entries(scheduleData || {})) {
    const byMovie = theaterVal?.schedule;
    if (!byMovie || typeof byMovie !== "object") continue;
    for (const [movieId, byDate] of Object.entries(byMovie)) {
      const meta = titleById.get(String(movieId));
      if (!meta) continue;
      for (const showings of Object.values(byDate || {})) {
        if (!Array.isArray(showings)) continue;
        for (const s of showings) {
          if (s?.isExpired) continue;
          const start = s?.startsAt;
          if (!start) continue;
          const parts = naivePTParts(start) || laParts(start);
          if (!parts || !inWindow(parts.date)) continue;
          const ticketUrl = s?.data?.ticketing?.[0]?.urls?.[0] || null;
          out.push({
            theater: "nuart",
            title: cleanTitle(meta.title),
            year: meta.year || extractYear(meta.title) || null,
            date: parts.date,
            time: parts.time,
            format: detectFormat(meta.title),
            series: null,
            url: ticketUrl || "https://www.landmarktheatres.com/los-angeles/nuart-theatre",
          });
        }
      }
    }
  }
  return dedupeScreenings(out);
}

// Walk an arbitrary JSON tree looking for objects that look like showtimes —
// `{ showtime / start_time / startTime, film / movie / title }` shapes used by
// various CMS exports.
function walkForShowtimes(node, theaterSlug, out, depth = 0) {
  if (depth > 8 || !node) return;
  if (Array.isArray(node)) {
    for (const x of node) walkForShowtimes(x, theaterSlug, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const start =
    node.startsAt || node.startTime || node.start_time || node.showtime || node.start || node.startDate;
  const titleRaw =
    node.filmTitle || node.film_title || node.title || node.name ||
    node.film?.title || node.movie?.title;
  if (start && titleRaw) {
    const parts =
      naivePTParts(start) ||
      laParts(start) ||
      icsTimeToParts(String(start));
    if (parts && inWindow(parts.date)) {
      out.push({
        theater: theaterSlug,
        title: cleanTitle(titleRaw),
        year: extractYear(titleRaw) || node.year || null,
        date: parts.date,
        time: parts.time,
        format: detectFormat(`${titleRaw} ${node.format || ""}`),
        series: node.series?.name || node.series || null,
        url: node.url || node.link || null,
      });
    }
  }
  for (const k of Object.keys(node)) {
    walkForShowtimes(node[k], theaterSlug, out, depth + 1);
  }
}

// Resolve a (month name, day) pair to a YYYY-MM-DD using today as the anchor.
// Vista's page exposes no year, only month names that may roll over (e.g.
// schedule running Dec → Jan). If the candidate date in the current LA year
// is more than a day in the past, assume the next year.
function resolveDateNearToday(monthName, day) {
  const month = MONTH_BY_NAME[String(monthName).toLowerCase()];
  if (!month || !day) return null;
  const padM = String(month).padStart(2, "0");
  const padD = String(day).padStart(2, "0");
  const todayY = Number(TODAY_LA.slice(0, 4));
  const candidate = `${todayY}-${padM}-${padD}`;
  if (candidate >= TODAY_LA) return candidate;
  // candidate < today → either yesterday/earlier-this-week or next year.
  const yesterday = new Date(`${TODAY_LA}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yTxt = yesterday.toISOString().slice(0, 10);
  return candidate < yTxt ? `${todayY + 1}-${padM}-${padD}` : candidate;
}

// Vista publishes a few weeks of programming on the home page as
// <div class="shows__grid--row"> blocks: each row has one schedule cell and
// one metadata cell. Schedule cells expose month markers, day labels, and
// Veezi ticket links per showtime. There's no JSON-LD or year on the page.
async function scrapeVista() {
  const url = "https://vistatheaterhollywood.com/";
  const html = await fetchText(url);

  const fromJsonLd = jsonLdEvents(html, "vista", url);
  if (fromJsonLd.length) return fromJsonLd;

  const sectionM = html.match(
    /<section[^>]*class="shows"[^>]*id="now-playing"[^>]*>([\s\S]*?)<\/section>/i
  );
  if (!sectionM) return [];
  const rows = sectionM[1].split(/<div\s+class="shows__grid--row"[^>]*>/);
  rows.shift(); // discard prefix before first row

  const out = [];
  for (const row of rows) {
    const cells = row.split(/<div\s+class="shows__grid--cell"[^>]*>/);
    if (cells.length < 3) continue;
    const scheduleHtml = cells[1];
    const metaHtml = cells[2];

    const titleM = metaHtml.match(/<h3[^>]*class="alt"[^>]*>([\s\S]*?)<\/h3>/i);
    const titleRaw = titleM ? stripTags(titleM[1]).trim() : "";
    if (!titleRaw) continue;

    // "<p>2026 | 1h 30m | 35mm Presentation</p>" — first 4-digit run is the
    // film's release year; format hint sits later in the same line.
    const metaLineM = metaHtml.match(/<p>\s*(\d{4})\s*\|[^<]*<\/p>/);
    const year = metaLineM ? Number(metaLineM[1]) : extractYear(titleRaw);
    const format = detectFormat(metaLineM ? metaLineM[0] : "");

    // "Late Show" / "Matinee" badge on the poster cell.
    const seriesM = metaHtml.match(/shows__grid--tag[^"]*"[^>]*>\s*([^<]+?)\s*<\/p>/);
    const series = seriesM ? decodeEntities(seriesM[1]).trim() : null;

    // Walk the schedule cell in source order. Month markers and day labels are
    // sticky; each <a> ticket link emits one screening using the current
    // (month, day) context.
    const tokens = [];
    const monthRe = /<p[^>]*\bmonth\b[^>]*>\s*([A-Za-z]+)\s*<\/p>/gi;
    const dayRe = /<p\s+class="text__size-2"[^>]*>\s*(\d{1,2})(?:st|nd|rd|th)?\s*<\/p>/gi;
    const timeRe = /<a\s+href="([^"]+)"[^>]*class="[^"]*card__button[^"]*"[^>]*>\s*([0-9:]+\s*[ap]m)\s*<\/a>/gi;
    let m;
    while ((m = monthRe.exec(scheduleHtml))) tokens.push({ kind: "month", value: m[1], pos: m.index });
    while ((m = dayRe.exec(scheduleHtml))) tokens.push({ kind: "day", value: Number(m[1]), pos: m.index });
    while ((m = timeRe.exec(scheduleHtml))) tokens.push({ kind: "time", href: m[1], time: m[2], pos: m.index });
    tokens.sort((a, b) => a.pos - b.pos);

    let curMonth = null;
    let curDay = null;
    for (const tok of tokens) {
      if (tok.kind === "month") curMonth = tok.value;
      else if (tok.kind === "day") curDay = tok.value;
      else if (tok.kind === "time" && curMonth && curDay) {
        const date = resolveDateNearToday(curMonth, curDay);
        if (!date || !inWindow(date)) continue;
        const time = parse12h(tok.time);
        if (!time) continue;
        out.push({
          theater: "vista",
          title: cleanTitle(titleRaw),
          year,
          date,
          time,
          format,
          series,
          url: tok.href,
        });
      }
    }
  }
  return out;
}

// Alamo Drafthouse Downtown LA.
//
// Strategy:
//   1. Fetch the Next.js theater page and pull __NEXT_DATA__. Even on SSR'd
//      Next.js apps the embedded blob often contains films/sessions pre-
//      fetched for the first paint, which is enough to populate showings.
//   2. If __NEXT_DATA__ doesn't contain showings, try a set of known/guessed
//      JSON endpoints. Alamo has historically served from `drafthouse.com
//      /s/mother/...`; the exact path has drifted over the years, so we try
//      several.
//   3. If all of that fails, the fetchText diagnostic sample captured during
//      step 1 will land in the committed JSON for the next iteration.
async function scrapeAlamoDtla() {
  const pageUrls = [
    "https://drafthouse.com/los-angeles/theater/downtown",
    "https://drafthouse.com/los-angeles",
  ];
  let html = "";
  for (const u of pageUrls) {
    try { html = await fetchText(u); if (html) break; } catch {}
  }

  if (html) {
    const nextM = html.match(
      /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (nextM) {
      try {
        const data = JSON.parse(nextM[1]);
        const hits = [];
        walkForShowtimes(data, "alamo-dtla", hits);
        if (hits.length) return dedupeScreenings(hits);
      } catch {}
    }
    const jl = jsonLdEvents(html, "alamo-dtla", pageUrls[0]);
    if (jl.length) return jl;
  }

  const candidates = [
    "https://drafthouse.com/s/mother/v2/schedule/market/los-angeles/cinema/downtown",
    "https://drafthouse.com/s/mother/v2/schedule/cinema/downtown",
    "https://drafthouse.com/api/v2/calendar/market/los-angeles/cinema/downtown",
    "https://drafthouse.com/api/v2/calendar/cinema/downtown-los-angeles",
    "https://drafthouse.com/api/v2/cinema/downtown-los-angeles/calendar",
    "https://drafthouse.com/s/mother/v2/schedule/cinema/downtown-los-angeles",
  ];
  let data = null;
  for (const url of candidates) {
    try { data = await fetchJson(url); if (data) break; } catch {}
  }
  if (!data) throw new Error("alamo-dtla: no calendar endpoint reachable");
  const out = [];
  walkForShowtimes(data, "alamo-dtla", out);
  return dedupeScreenings(out);
}

// Academy Museum. Their Next.js calendar is driven by a ticketing backend at
// tickets.academymuseum.org; the `cached_api/events/available` endpoint
// returns film-screening events with embedded sessions and venue info.
// Each event has a single title + N event_sessions (one per showtime); we
// flatten one screening per session.
async function scrapeAcademyMuseum() {
  const categories = [
    "Film Screening",
    "Film Screening: Matinee",
    "Film Screening: Double Feature",
  ].join(",");
  // API wants `...start_datetime._gte=<ISO UTC>`. Use start-of-today-LA
  // expressed as UTC (= 07:00Z during PDT, 08:00Z during PST); an off-by-
  // an-hour here is harmless because we re-filter by inWindow below.
  const gte = `${TODAY_LA}T07:00:00.000Z`;
  const params = new URLSearchParams({
    "event_session.start_datetime._gte": gte,
    "_withmemberevents": "",
    "category._in": categories,
    "_embed": "event_session,venue",
    "_sort": "event_session.start_datetime",
  });
  const url = `https://tickets.academymuseum.org/cached_api/events/available?${params.toString()}`;

  const data = await fetchJson(url);

  // cached_api returns a relational document: top-level keys are collection
  // names (event_session, event_template, venue), each with { _count, _data }.
  // Join sessions → templates via event_template_id; templates → venues via
  // venue_id. Titles live on the template (field: `name`).
  const templates = new Map();
  for (const t of data?.event_template?._data || []) {
    if (t?.id) {
      templates.set(t.id, {
        name: t.name || t.title || "",
        category: t.category || null,
        venue_id: t.venue_id || null,
      });
    }
  }
  const venues = new Map();
  for (const v of data?.venue?._data || []) {
    if (v?.id) venues.set(v.id, v.name || v.display_name || null);
  }

  const out = [];
  for (const s of data?.event_session?._data || []) {
    const tmpl = templates.get(s?.event_template_id);
    const title = tmpl?.name;
    const start = s?.start_datetime;
    if (!title || !start) continue;
    const parts = laParts(start);
    if (!parts || !inWindow(parts.date)) continue;
    const venueName = tmpl.venue_id ? venues.get(tmpl.venue_id) : null;
    out.push({
      theater: "academy-museum",
      title: cleanTitle(title),
      year: extractYear(title),
      date: parts.date,
      time: parts.time,
      format: detectFormat(title),
      series: tmpl.category || venueName || null,
      url: "https://www.academymuseum.org/en/calendar",
    });
  }
  return dedupeScreenings(out);
}

// Brain Dead Studios lives at studios.wearebraindead.com (old braindead.studio
// 404s). /coming-soon/ is their schedule page — a Filmbot-powered WordPress
// site with server-rendered HTML. Each film is a <div class="show-details">
// block containing a title link, a show-specs line (Director / Run Time /
// Format / Release Year), and N <li data-date="..."> entries with ticket
// links. The `data-date` timestamp is the theater-day anchor (3am PT); the
// specific time ("7:00 pm") lives in the <a class="showtime"> text.
async function scrapeBrainDeadStudios() {
  const url = "https://studios.wearebraindead.com/coming-soon/";
  const html = await fetchText(url);

  const out = [];
  const blockRe = /<div\s+class="show-details">([\s\S]*?)<\/div><!-- \.show-details -->/gi;
  let b;
  while ((b = blockRe.exec(html))) {
    const block = b[1];

    const titleM = block.match(
      /<h2[^>]*class="show-title"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i
    );
    if (!titleM) continue;
    const filmUrl = titleM[1];
    const titleRaw = decodeEntities(stripTags(titleM[2])).trim();
    if (!titleRaw) continue;

    const yearM = block.match(
      /show-spec-label">Release Year:<\/span>\s*(\d{4})/
    );
    const year = yearM ? Number(yearM[1]) : extractYear(titleRaw);

    const formatM = block.match(
      /show-spec-label">Format:<\/span>\s*([^<\s][^<]*)/
    );
    const format = detectFormat(formatM ? formatM[1] : "");

    const showtimeRe =
      /<li\s+data-date="(\d+)"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*class="[^"]*\bshowtime\b[^"]*"[^>]*>\s*([0-9:]+\s*[ap]m)\s*<\/a>\s*<\/li>/gi;
    let st;
    while ((st = showtimeRe.exec(block))) {
      const ts = Number(st[1]);
      if (!Number.isFinite(ts)) continue;
      const parts = laParts(new Date(ts * 1000));
      if (!parts || !inWindow(parts.date)) continue;
      const time = parse12h(st[3]);
      if (!time) continue;
      out.push({
        theater: "brain-dead",
        title: cleanTitle(titleRaw),
        year: year || null,
        date: parts.date,
        time,
        format,
        series: null,
        url: st[2] || filmUrl,
      });
    }
  }
  return dedupeScreenings(out);
}


// Fathom Entertainment. Flow:
//   1. Scrape /releases/?fwp_events_genres=33 → list of classic films (url,
//      title, series).
//   2. For each film, fetch its detail page → extract `data-event-id` (the
//      Fathom internal event ID, distinct from the WP post id on the list).
//   3. Call api.fathomentertainment.com/api/events/showtimes with an LA
//      lat/lng → XML response with up to 25 nearest theaters, each with its
//      own per-date showtimes and Fandango ticket URLs.
//   4. Register each distinct theater in THEATERS on the fly so the UI can
//      filter by individual venue (AMC Burbank 16, Regal LA Live, etc.) and
//      emit one screening per (film, theater, date, time).
//
// Classics only; Studio Ghibli / Met Opera / etc. live under other genre
// IDs and aren't pulled here.
async function scrapeFathomEvents() {
  const listUrl = "https://www.fathomentertainment.com/releases/?fwp_events_genres=33";
  const listHtml = await fetchText(listUrl);

  // Step 1: harvest (url, title, series) from the list page.
  const films = [];
  const itemRe = /<a\s+href="([^"]+)"[^>]*class="posters-item"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = itemRe.exec(listHtml))) {
    const url = m[1];
    const block = m[2];
    const titleM = block.match(/<h3[^>]*class="headline"[^>]*>\s*([\s\S]*?)\s*<\/h3>/i);
    if (!titleM) continue;
    const title = decodeEntities(stripTags(titleM[1])).trim();
    if (!title) continue;
    const seriesM = block.match(/<div[^>]*class="preheadline"[^>]*>\s*([\s\S]*?)\s*<\/div>/i);
    const series = seriesM ? decodeEntities(stripTags(seriesM[1])).trim() : null;
    films.push({ url, title, series });
  }
  if (!films.length) return [];

  const LA_LAT = "34.0522";
  const LA_LNG = "-118.2437";
  const KNOWN = new Set(THEATERS.map((t) => t.slug));
  const out = [];

  // XML lives in a .NET DataContract namespace; we only care about the
  // leaf text so a few per-field regex matches are cheaper than a full
  // parser.
  const xmlField = (block, tag) => {
    const r = new RegExp(`<${tag}>([^<]*)</${tag}>`);
    const hit = block.match(r);
    return hit ? decodeEntities(hit[1]).trim() : null;
  };

  for (const film of films) {
    // Step 2: extract eventID from the detail page.
    let detailHtml = "";
    try { detailHtml = await fetchText(film.url); } catch {}
    const eidM = detailHtml.match(/data-event-id="(\d+)"/);
    if (!eidM) continue;
    const eventID = eidM[1];

    // Step 3: call the showtimes API.
    const apiUrl = `https://api.fathomentertainment.com/api/events/showtimes?lat=${LA_LAT}&lng=${LA_LNG}&eventID=${eventID}&maxTheaters=25`;
    let xml = "";
    try { xml = await fetchText(apiUrl); } catch { continue; }

    const showDateRe = /<ShowDate>([\s\S]*?)<\/ShowDate>/g;
    let sd;
    while ((sd = showDateRe.exec(xml))) {
      const sdBlock = sd[1];
      const dateStr = xmlField(sdBlock, "Date");
      if (!dateStr) continue;
      // API gives dates as M/D/YYYY.
      const dm = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!dm) continue;
      const date = `${dm[3]}-${dm[1].padStart(2, "0")}-${dm[2].padStart(2, "0")}`;
      if (!inWindow(date)) continue;

      const theaterRe = /<ShowtimeTheater>([\s\S]*?)<\/ShowtimeTheater>/g;
      let th;
      while ((th = theaterRe.exec(sdBlock))) {
        const thBlock = th[1];
        const theaterName = xmlField(thBlock, "TheaterName");
        const theaterID = xmlField(thBlock, "TheaterID");
        if (!theaterName || !theaterID) continue;
        if (!FATHOM_THEATER_ALLOWLIST.has(theaterID)) continue;
        const theaterSlug = `fathom-${theaterID}`;

        // Step 4: register the theater once per run.
        if (!KNOWN.has(theaterSlug)) {
          const addr = xmlField(thBlock, "Address1") || "";
          const city = xmlField(thBlock, "City") || "";
          const state = xmlField(thBlock, "State") || "";
          THEATERS.push({
            slug: theaterSlug,
            name: theaterName,
            address: [addr, city, state].filter(Boolean).join(", "),
            url: "https://www.fathomentertainment.com/",
          });
          KNOWN.add(theaterSlug);
        }

        const showtimeRe = /<Showtime>([\s\S]*?)<\/Showtime>/g;
        let st;
        while ((st = showtimeRe.exec(thBlock))) {
          const stBlock = st[1];
          const timeStr = xmlField(stBlock, "Time");
          const purchaseUrl = xmlField(stBlock, "PurchaseURL");
          if (!timeStr) continue;
          const time = parse12h(timeStr);
          if (!time) continue;
          out.push({
            theater: theaterSlug,
            title: cleanTitle(film.title),
            year: extractYear(film.title),
            date,
            time,
            format: null,
            series: film.series,
            url: purchaseUrl || film.url,
          });
        }
      }
    }

    // Be polite between film fetches.
    await sleep(400);
  }
  return dedupeScreenings(out);
}

// AMC's REST API at api.amctheatres.com. Auth'd via X-AMC-Vendor-Key header
// with a free developer key (register at developers.amctheatres.com). Unlike
// amctheatres.com the API subdomain isn't behind Cloudflare Turnstile, so it
// works from CI. Without the key set, this source fails gracefully and the
// rest of the scrape still runs.
//
// Endpoint: GET /v2/theatres/{id}/showtimes/{YYYY-MM-DD}
//   → HAL-wrapped list of showings for a theatre on a date, each with:
//       movieName, movieId, showDateTimeLocal (naive PT), websiteUrl,
//       attributes[] (array of {code,name} or string codes), format{code}, ...
//   Attributes include `fanfaves` for AMC's Fan Faves rerelease series, which
//   is our rereleases-only signal. Other codes (imax, dolbycinemaatamcprime,
//   amcartisanfilms, thrlschls) are first-run presentation formats or
//   programs and are dropped. The global isRerelease year filter applied
//   later is a safety net.
async function scrapeAmcPreferredTheatres() {
  const key = process.env.AMC_API_KEY;
  if (!key) throw new Error("AMC_API_KEY not configured (set it as a GitHub Actions secret)");

  // Register our 6 favorited venues on the first run so the UI has stable
  // names even if a theatre returns zero fanfaves showings this window.
  const known = new Set(THEATERS.map((t) => t.slug));
  for (const t of AMC_PREFERRED_THEATERS) {
    if (!known.has(t.slug)) {
      THEATERS.push({ slug: t.slug, name: t.name, address: t.address, url: t.url });
      known.add(t.slug);
    }
  }

  // Build the date list covering the same horizon as the rest of the scraper.
  // AMC's API is per-date, so we fan out 6 theatres × HORIZON_DAYS dates. At
  // 60 days that's 360 calls/run — well under any reasonable quota; sleep
  // between calls keeps us polite.
  const dates = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const d = new Date(`${TODAY_LA}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const headers = { "X-AMC-Vendor-Key": key };
  const out = [];

  // Attributes come back as either [{code,name}] (v2) or bare string codes
  // depending on the endpoint version. Normalize both.
  const hasCode = (attrs, code) => {
    if (!Array.isArray(attrs)) return false;
    return attrs.some((a) => (typeof a === "string" ? a : a?.code) === code);
  };

  for (const theater of AMC_PREFERRED_THEATERS) {
    for (const date of dates) {
      const url = `https://api.amctheatres.com/v2/theatres/${theater.theatreId}/showtimes/${date}?page-size=200`;
      let data;
      try {
        data = await fetchJson(url, headers);
      } catch {
        // 404 = no showtimes on that date for that theatre. Common; skip.
        continue;
      }
      const showings = data?._embedded?.showtimes || data?.showtimes || [];
      for (const s of showings) {
        const start = s.showDateTimeLocal || s.showDateTimeUtc;
        if (!start) continue;
        const parts = naivePTParts(start) || laParts(start);
        if (!parts || !inWindow(parts.date)) continue;
        const name = decodeEntities(s.movieName || "");
        const cleaned = cleanTitle(name);
        if (!hasCode(s.attributes, "fanfaves")) {
          // First-run programming — record its title so the client can
          // filter the New Releases list to films playing locally.
          if (cleaned) AMC_LOCAL_TITLES.add(slugifyTitle(cleaned));
          continue;
        }
        out.push({
          theater: theater.slug,
          title: cleaned,
          year: extractYear(name),
          date: parts.date,
          time: parts.time,
          format: detectFormat(s.format?.code || s.format?.name || name),
          series: "Fan Faves",
          url: s.websiteUrl || s._links?.purchase?.href || theater.url,
        });
      }
      await sleep(150);
    }
  }
  return dedupeScreenings(out);
}

// ---------- Source orchestration ----------

const SOURCES = [
  { id: "new-beverly", theaters: ["new-beverly"], fn: scrapeNewBeverly },
  { id: "american-cinematheque", theaters: ["aero", "egyptian", "los-feliz-theatre"], fn: scrapeAmericanCinematheque },
  { id: "nuart", theaters: ["nuart"], fn: scrapeNuart },
  { id: "vista", theaters: ["vista"], fn: scrapeVista },
  { id: "alamo-dtla", theaters: ["alamo-dtla"], fn: scrapeAlamoDtla },
  { id: "academy-museum", theaters: ["academy-museum"], fn: scrapeAcademyMuseum },
  { id: "brain-dead", theaters: ["brain-dead"], fn: scrapeBrainDeadStudios },
  { id: "amc-preferred", theaters: AMC_PREFERRED_THEATERS.map((t) => t.slug), fn: scrapeAmcPreferredTheatres },
  // Fathom's specific venue slugs are discovered at run time and all start
  // with "fathom-"; use a prefix match instead of a static theater list.
  { id: "fathom", theaterPrefix: "fathom-", fn: scrapeFathomEvents },
];

function dedupeScreenings(rows) {
  const seen = new Map();
  for (const r of rows) {
    const k = `${r.theater}|${r.date}|${r.time}|${slugify(r.title)}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  return [...seen.values()];
}

function loadPrevious() {
  try {
    const j = JSON.parse(readFileSync("data/repertory.json", "utf8"));
    return {
      screenings: Array.isArray(j.screenings) ? j.screenings : [],
      amc_local_titles: Array.isArray(j.amc_local_titles) ? j.amc_local_titles : [],
    };
  } catch {
    return { screenings: [], amc_local_titles: [] };
  }
}

const previousData = loadPrevious();
const previous = previousData.screenings;
const allScreenings = [];
const sourceStatus = [];

for (const src of SOURCES) {
  _debug.currentSource = src.id;
  _debug.sampleBySource.delete(src.id);
  try {
    const rows = await src.fn();
    allScreenings.push(...rows);
    const entry = { id: src.id, count: rows.length, status: "ok" };
    // Attach a page sample when the fetch succeeded but no events were
    // extracted — usually means the parser is looking at the wrong shape.
    if (rows.length === 0) {
      const sample = _debug.sampleBySource.get(src.id);
      if (sample) {
        entry.sample_url = sample.url;
        entry.sample_bytes = sample.bytes;
        entry.sample = sample.sample;
      }
    }
    sourceStatus.push(entry);
    console.log(`${src.id}: ${rows.length} screenings`);
    await sleep(400);
  } catch (e) {
    console.warn(`${src.id} FAILED: ${e.message}`);
    const kept = previous.filter((s) => {
      if (!inWindow(s.date)) return false;
      if (src.theaters?.includes(s.theater)) return true;
      if (src.theaterPrefix && String(s.theater).startsWith(src.theaterPrefix)) return true;
      return false;
    });
    allScreenings.push(...kept);
    // Carry forward the previous AMC first-run title list so the "Only at
    // my AMCs" filter doesn't suddenly empty when the AMC API hiccups.
    if (src.id === "amc-preferred") {
      for (const t of previousData.amc_local_titles) AMC_LOCAL_TITLES.add(t);
    }
    sourceStatus.push({ id: src.id, count: kept.length, status: `failed: ${e.message}` });
  }
}
_debug.currentSource = null;

// Rereleases-only: drop any screening whose film release year matches or
// exceeds its screening year (i.e. first-run programming at Vista, Alamo,
// Brain Dead). Unknown-year rows are kept — most rep houses fail to expose
// a year in markup and are reliably older films.
const isRerelease = (s) => {
  if (s.year == null) return true;
  const screeningYear = Number((s.date || "").slice(0, 4));
  return Number.isFinite(screeningYear) && s.year < screeningYear;
};

const cleaned = dedupeScreenings(
  allScreenings
    .filter((s) => s && s.title && s.date && s.time && inWindow(s.date))
    .filter(isRerelease)
    .map((s) => ({
      theater: s.theater,
      title: s.title,
      year: s.year ?? null,
      date: s.date,
      time: s.time,
      format: s.format || null,
      series: s.series || null,
      url: s.url || null,
    }))
).sort(
  (a, b) =>
    a.date.localeCompare(b.date) ||
    a.time.localeCompare(b.time) ||
    a.theater.localeCompare(b.theater) ||
    a.title.localeCompare(b.title)
);

// Enrich each screening with `youtube_trailer_id` via TMDB. We only look up
// each unique (title, year) pair once and fan the result back out to every
// showtime — a single rep run can have 8+ screenings. No-op if TMDB_TOKEN
// isn't set so this script still runs locally without credentials.
await enrichTrailers(cleaned);

const out = {
  updated: new Date().toISOString().slice(0, 10),
  source: "Per-theater scrapers",
  sources: sourceStatus,
  theaters: THEATERS,
  screenings: cleaned,
  amc_local_titles: [...AMC_LOCAL_TITLES].sort(),
};

mkdirSync("data", { recursive: true });
const filename = "data/repertory.json";
const payload = JSON.stringify(out, null, 2) + "\n";

let changed = true;
try {
  changed = readFileSync(filename, "utf8") !== payload;
} catch {}
writeFileSync(filename, payload);
console.log(
  `${changed ? "Updated" : "Unchanged"} ${filename} (${cleaned.length} screenings across ${THEATERS.length} theaters)`
);
