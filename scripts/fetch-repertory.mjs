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
  { slug: "vista", name: "Vista Theater", address: "4473 Sunset Dr, Los Angeles", url: "https://vistatheaterhollywood.com/" },
  { slug: "los-feliz-3", name: "Los Feliz 3", address: "1822 N Vermont Ave, Los Angeles", url: "https://vintagecinemas.com/losfeliz/" },
  { slug: "alamo-dtla", name: "Alamo Drafthouse DTLA", address: "700 W 7th St, Los Angeles", url: "https://drafthouse.com/los-angeles" },
  { slug: "academy-museum", name: "Academy Museum", address: "6067 Wilshire Blvd, Los Angeles", url: "https://www.academymuseum.org/en/programs" },
  { slug: "brain-dead", name: "Brain Dead Studios", address: "611 N Fairfax Ave, Los Angeles", url: "https://braindead.studio/" },
  { slug: "lumiere", name: "Lumiere Music Hall", address: "9036 Wilshire Blvd, Beverly Hills", url: "https://www.laemmle.com/theater/music-hall" },
];

// AMC Classics — LA-area whitelist. Names match AMC's "name" field for fuzzy
// matching against showtimes; theater IDs are filled in by the scraper at
// runtime if needed.
const LA_AMC_THEATERS = [
  { slug: "amc-century-city-15", name: "AMC Century City 15", address: "10250 Santa Monica Blvd, Los Angeles" },
  { slug: "amc-citywalk", name: "AMC Universal CityWalk", address: "100 Universal City Plaza, Universal City" },
  { slug: "amc-burbank-16", name: "AMC Burbank 16", address: "125 E Palm Ave, Burbank" },
  { slug: "amc-del-amo-18", name: "AMC Del Amo 18", address: "3525 W Carson St, Torrance" },
  { slug: "amc-santa-monica-7", name: "AMC Santa Monica 7", address: "1310 3rd St Promenade, Santa Monica" },
  { slug: "amc-marina-marketplace-6", name: "AMC Marina Marketplace 6", address: "13455 Maxella Ave, Marina del Rey" },
  { slug: "amc-marina-pacifica-12", name: "AMC Marina Pacifica 12", address: "6346 E Pacific Coast Hwy, Long Beach" },
];
for (const t of LA_AMC_THEATERS) {
  t.url = "https://www.amctheatres.com/amc-classic-series";
  THEATERS.push(t);
}

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

const NB_MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
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
    const monthNum = NB_MONTHS[monthName];
    if (!monthNum) continue;

    // Year roll-over: if the heading is December and a card shows a January
    // day, that day is in the following calendar year.
    let year = headingYear;
    if (headingMonth && monthName !== headingMonth &&
        NB_MONTHS[headingMonth] === 12 && monthNum === 1) {
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

// American Cinematheque (Aero + Egyptian). Their site emits Schema.org Event
// nodes per screening with a `location.name` we can use to route to the right
// venue.
async function scrapeAmericanCinematheque() {
  const candidates = [
    "https://www.americancinematheque.com/now-showing/",
    "https://www.americancinematheque.com/calendar/",
  ];
  let html = "";
  let lastErr = null;
  for (const url of candidates) {
    try {
      html = await fetchText(url);
      if (html) break;
    } catch (e) { lastErr = e; }
  }
  if (!html) throw lastErr || new Error("ac: no candidate URL succeeded");

  const out = [];
  for (const b of extractJsonLd(html)) {
    for (const ev of flattenEvents(b)) {
      const start = ev.startDate;
      if (!start) continue;
      const parts = String(start).endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(String(start))
        ? laParts(start)
        : (naivePTParts(start) || laParts(start));
      if (!parts || !inWindow(parts.date)) continue;
      const venue = String(ev.location?.name || ev.location || "").toLowerCase();
      let theaterSlug = null;
      if (venue.includes("aero")) theaterSlug = "aero";
      else if (venue.includes("egyptian")) theaterSlug = "egyptian";
      else continue;
      const name = ev.name || "";
      out.push({
        theater: theaterSlug,
        title: cleanTitle(name),
        year: extractYear(name),
        date: parts.date,
        time: parts.time,
        format: detectFormat(name + " " + (ev.description || "")),
        series: ev.superEvent?.name || null,
        url: ev.url || "https://www.americancinematheque.com/now-showing/",
      });
    }
  }
  return out;
}

// Nuart (Landmark). Landmark's per-theater page is a Next.js SSR app; the page
// embeds JSON in __NEXT_DATA__ that includes showtimes.
async function scrapeNuart() {
  const html = await fetchText("https://www.landmarktheatres.com/los-angeles/nuart-theatre");
  const out = [];
  // Try the JSON-LD path first.
  for (const b of extractJsonLd(html)) {
    for (const ev of flattenEvents(b)) {
      const start = ev.startDate;
      if (!start) continue;
      const parts = laParts(start);
      if (!parts || !inWindow(parts.date)) continue;
      const name = ev.name || ev.workPresented?.name || "";
      out.push({
        theater: "nuart",
        title: cleanTitle(name),
        year: extractYear(name),
        date: parts.date,
        time: parts.time,
        format: detectFormat(name),
        series: null,
        url: ev.url || "https://www.landmarktheatres.com/los-angeles/nuart-theatre",
      });
    }
  }
  if (out.length) return out;
  // Fallback: extract __NEXT_DATA__ blob and look for showtimes objects.
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1]);
      walkForShowtimes(data, "nuart", out);
    } catch (e) {
      console.warn(`nuart: __NEXT_DATA__ parse: ${e.message}`);
    }
  }
  return out;
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
    node.startTime || node.start_time || node.showtime || node.start || node.startDate;
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

async function scrapeVista() {
  const html = await fetchText("https://vistatheaterhollywood.com/");
  const out = jsonLdEvents(html, "vista", "https://vistatheaterhollywood.com/");
  if (out.length) return out;
  // Vista uses Squarespace; fall back to walking the embedded data blob.
  const m = html.match(/Static\.SQUARESPACE_CONTEXT\s*=\s*({[\s\S]*?});/);
  if (m) {
    try {
      const ctx = JSON.parse(m[1]);
      walkForShowtimes(ctx, "vista", out);
    } catch {}
  }
  return out;
}

async function scrapeLosFeliz3() {
  const html = await fetchText("https://vintagecinemas.com/losfeliz/");
  return jsonLdEvents(html, "los-feliz-3", "https://vintagecinemas.com/losfeliz/");
}

// Alamo Drafthouse exposes a public showtimes JSON API.
async function scrapeAlamoDtla() {
  // Cinema slug for DTLA in Alamo's API; their public site uses "downtown-los-angeles".
  const candidates = [
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
  // De-duplicate (same showtime referenced under multiple keys in the tree).
  return dedupeScreenings(out);
}

async function scrapeAcademyMuseum() {
  const html = await fetchText("https://www.academymuseum.org/en/programs");
  return jsonLdEvents(html, "academy-museum", "https://www.academymuseum.org/en/programs");
}

async function scrapeBrainDeadStudios() {
  const html = await fetchText("https://braindead.studio/");
  const out = jsonLdEvents(html, "brain-dead", "https://braindead.studio/");
  if (out.length) return out;
  // BD is Webflow + a custom calendar widget. Look for embedded JSON.
  const m = html.match(/window\.__SHOWTIMES__\s*=\s*(\[[\s\S]*?\]);/);
  if (m) {
    try {
      const arr = JSON.parse(m[1]);
      walkForShowtimes(arr, "brain-dead", out);
    } catch {}
  }
  return out;
}

async function scrapeLumiere() {
  // Laemmle exposes per-theater showtimes pages with JSON-LD.
  const html = await fetchText("https://www.laemmle.com/theater/music-hall");
  return jsonLdEvents(html, "lumiere", "https://www.laemmle.com/theater/music-hall");
}

// AMC Classics: AMC's site is a heavily-defended SPA. Scraping reliably is a
// project of its own; first pass returns [] and logs a TODO so the rest of the
// pipeline still runs. Future work: hit api.amctheatres.com with an API key
// stored as a repo secret, filter showtimes where program === "AMC Classics"
// AND theater is in LA_AMC_THEATERS.
async function scrapeAMCClassics() {
  console.warn("amc-classics: scraper not yet implemented (returning 0 screenings)");
  return [];
}

// ---------- Source orchestration ----------

const SOURCES = [
  { id: "new-beverly", theaters: ["new-beverly"], fn: scrapeNewBeverly },
  { id: "american-cinematheque", theaters: ["aero", "egyptian"], fn: scrapeAmericanCinematheque },
  { id: "nuart", theaters: ["nuart"], fn: scrapeNuart },
  { id: "vista", theaters: ["vista"], fn: scrapeVista },
  { id: "los-feliz-3", theaters: ["los-feliz-3"], fn: scrapeLosFeliz3 },
  { id: "alamo-dtla", theaters: ["alamo-dtla"], fn: scrapeAlamoDtla },
  { id: "academy-museum", theaters: ["academy-museum"], fn: scrapeAcademyMuseum },
  { id: "brain-dead", theaters: ["brain-dead"], fn: scrapeBrainDeadStudios },
  { id: "lumiere", theaters: ["lumiere"], fn: scrapeLumiere },
  { id: "amc-classics", theaters: LA_AMC_THEATERS.map((t) => t.slug), fn: scrapeAMCClassics },
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
    return Array.isArray(j.screenings) ? j.screenings : [];
  } catch {
    return [];
  }
}

const previous = loadPrevious();
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
    const kept = previous.filter((s) => src.theaters.includes(s.theater) && inWindow(s.date));
    allScreenings.push(...kept);
    sourceStatus.push({ id: src.id, count: kept.length, status: `failed: ${e.message}` });
  }
}
_debug.currentSource = null;

const cleaned = dedupeScreenings(
  allScreenings
    .filter((s) => s && s.title && s.date && s.time && inWindow(s.date))
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

const out = {
  updated: new Date().toISOString().slice(0, 10),
  source: "Per-theater scrapers",
  sources: sourceStatus,
  theaters: THEATERS,
  screenings: cleaned,
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
