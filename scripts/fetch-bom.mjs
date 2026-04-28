#!/usr/bin/env node
// Fetches release data from Box Office Mojo's calendar (the authoritative
// list of what's actually booked into US theaters) and enriches each title
// via TMDB for fields BOM doesn't expose: director, budget, tagline, and a
// stable tmdb_id used as the frontend's movie key.
//
// BOM is gospel: every row that appears on the calendar lands in the output
// (modulo the re-release filter below). TMDB is consulted per-title via the
// IMDb ID that BOM exposes; if TMDB has no match we still emit the row with
// the fields BOM provides.
//
// Re-releases (e.g. a 1976 Janus Films print appearing in a 2026 calendar)
// are dropped by comparing TMDB's primary release_date year to the calendar
// year. The threshold of 3 years preserves festival-to-theatrical rollouts
// (festival 2024 → theatrical 2026 is kept).
//
// Env: TMDB_TOKEN (v4 Read Access Token), MONTH (YYYY-MM, defaults to current)

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

const RERELEASE_YEAR_THRESHOLD = 3;

const TMDB_API = "https://api.themoviedb.org/3";
const tmdbHeaders = { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" };

const BOM_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

async function tmdbGet(path) {
  const r = await fetch(`${TMDB_API}${path}`, { headers: tmdbHeaders });
  if (!r.ok) throw new Error(`TMDB ${r.status} ${path}`);
  return r.json();
}

async function bomGet(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": BOM_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!r.ok) throw new Error(`BOM ${r.status} ${url}`);
  return r.text();
}

// Every Friday inside the target month. Each Friday's BOM calendar page
// lists the films opening that week (Fri..Thu); the Friday is the canonical
// release date we record. Mid-week openings (Wed/Thu) get rolled to the
// week's Friday — BOM doesn't surface a per-row date and the precision loss
// is acceptable for a monthly view.
function fridaysInMonth(y, m) {
  const out = [];
  const cursor = new Date(Date.UTC(y, m - 1, 1));
  while (cursor.getUTCDay() !== 5) cursor.setUTCDate(cursor.getUTCDate() + 1);
  const last = new Date(Date.UTC(y, m, 0));
  while (cursor <= last) {
    out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}

// Parse a single BOM calendar row. Returns null if the row isn't a film row
// (header rows, layout rows, etc. don't carry a /release/ link).
function parseRow(rowHtml) {
  const releaseLink = rowHtml.match(
    /<a[^>]+href="\/release\/(rl\d+)\/[^"]*"[^>]*>/i
  );
  if (!releaseLink) return null;

  const titleMatch = rowHtml.match(/<h3>([\s\S]*?)<\/h3>/i);
  if (!titleMatch) return null;
  const title = stripTags(titleMatch[1]);
  if (!title) return null;

  const imdbMatch = rowHtml.match(/pro\.imdb\.com\/title\/(tt\d+)/i);

  const studiosCellMatch = rowHtml.match(
    /<td[^>]*mojo-field-type-release_studios[^>]*>([\s\S]*?)<\/td>/i
  );
  const distributorRaw = studiosCellMatch ? stripTags(studiosCellMatch[1]) : "";
  const distributor = distributorRaw && distributorRaw !== "-" ? distributorRaw : null;

  const scaleCellMatch = rowHtml.match(
    /<td[^>]*mojo-field-type-release_scale[^>]*>([\s\S]*?)<\/td>/i
  );
  const scaleText = scaleCellMatch ? stripTags(scaleCellMatch[1]).toLowerCase() : "";
  const release_type = /\bwide\b/.test(scaleText) ? "wide" : "limited";

  const genresMatch = rowHtml.match(
    /<div class="a-section a-spacing-none mojo-schedule-genres">([\s\S]*?)<\/div>/i
  );
  const genres = genresMatch
    ? stripTags(genresMatch[1])
        .split(/\s+/)
        .filter(Boolean)
    : [];

  const castMatch = rowHtml.match(
    /<span class="a-text-bold">With:\s*<\/span>([\s\S]*?)<\/div>/i
  );
  const bom_cast = castMatch ? stripTags(castMatch[1]) : null;

  return {
    title,
    release_id: releaseLink[1],
    imdb_id: imdbMatch ? imdbMatch[1] : null,
    distributor,
    release_type,
    genres,
    bom_cast,
  };
}

function parseCalendarHtml(html) {
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowRe.exec(html))) {
    const parsed = parseRow(match[1]);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

async function fetchBomMonth(y, m) {
  const out = [];
  const seen = new Set();
  for (const friday of fridaysInMonth(y, m)) {
    const ymd = friday.toISOString().slice(0, 10);
    try {
      const html = await bomGet(`https://www.boxofficemojo.com/calendar/${ymd}/`);
      for (const row of parseCalendarHtml(html)) {
        if (seen.has(row.release_id)) continue;
        seen.add(row.release_id);
        out.push({ ...row, date: ymd });
      }
      await sleep(300);
    } catch (e) {
      console.warn(`BOM ${ymd}: ${e.message}`);
    }
  }
  return out;
}

// Pull every US theatrical (release_type 2 = limited, 3 = wide) date from
// TMDB's release_dates payload, oldest first.
function usTheatricalDates(d) {
  const us = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === "US");
  if (!us) return [];
  return us.release_dates
    .filter((r) => r.type === 2 || r.type === 3)
    .map((r) => r.release_date.slice(0, 10))
    .sort();
}

async function enrich(rows) {
  const calendarYear = +year;
  const out = [];
  let droppedRerelease = 0;
  let droppedOtherMonth = 0;
  for (const row of rows) {
    let tmdb_id = null;
    let director = "—";
    let budget_usd = null;
    let notes = "";
    let cast = row.bom_cast || "—";
    let genre = row.genres.length ? row.genres.join(" / ") : "—";
    let originalYear = null;
    let tmdbTheatricalDates = null;

    if (row.imdb_id) {
      try {
        const find = await tmdbGet(`/find/${row.imdb_id}?external_source=imdb_id`);
        const movie = find.movie_results?.[0];
        if (movie) {
          tmdb_id = movie.id;
          await sleep(35);
          const d = await tmdbGet(
            `/movie/${movie.id}?append_to_response=credits,release_dates`
          );
          director =
            (d.credits?.crew || [])
              .filter((c) => c.job === "Director")
              .map((c) => c.name)
              .join(", ") || "—";
          const tmdbCast = (d.credits?.cast || [])
            .slice(0, 4)
            .map((c) => c.name)
            .join(", ");
          if (tmdbCast) cast = tmdbCast;
          budget_usd = d.budget || null;
          notes = d.tagline || "";
          if (d.genres?.length) genre = d.genres.map((g) => g.name).join(" / ");
          originalYear = d.release_date ? +d.release_date.slice(0, 4) : null;
          tmdbTheatricalDates = usTheatricalDates(d);
        }
        await sleep(35);
      } catch (e) {
        console.warn(`TMDB enrich ${row.imdb_id} (${row.title}): ${e.message}`);
      }
    }

    if (
      originalYear !== null &&
      originalYear < calendarYear - RERELEASE_YEAR_THRESHOLD
    ) {
      console.log(`Drop re-release: ${row.title} (${originalYear})`);
      droppedRerelease++;
      continue;
    }

    // BOM's calendar pages list multiple weeks of upcoming films, not just
    // the URL's Friday — so the URL alone is unreliable as a release date.
    // Prefer the earliest TMDB US theatrical date that falls in the target
    // month. If TMDB knows about US theatrical dates but none is in the
    // target month, the row belongs to a different month's file (drop).
    // Fall back to the BOM URL Friday only when TMDB has no US theatrical
    // entries at all (rare; mostly tiny indies TMDB hasn't indexed).
    let date;
    if (tmdbTheatricalDates && tmdbTheatricalDates.length) {
      const inMonth = tmdbTheatricalDates.find((d) => d.slice(0, 7) === MONTH);
      if (inMonth) {
        date = inMonth;
      } else {
        droppedOtherMonth++;
        continue;
      }
    } else {
      date = row.date;
    }

    out.push({
      tmdb_id,
      date,
      title: row.title,
      director,
      studio: row.distributor || "—",
      budget_usd,
      release_type: row.release_type,
      genre,
      cast,
      notes,
    });
  }
  if (droppedRerelease) console.log(`Dropped ${droppedRerelease} re-release(s).`);
  if (droppedOtherMonth)
    console.log(`Dropped ${droppedOtherMonth} listing(s) belonging to other months.`);
  return out;
}

const bomRows = await fetchBomMonth(+year, +mm);
console.log(`BOM: ${bomRows.length} listing(s) for ${MONTH}`);

const releases = await enrich(bomRows);
releases.sort(
  (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)
);

const monthName = new Date(`${year}-${mm}-01T12:00:00Z`).toLocaleString("en-US", {
  month: "long",
});
const out = {
  month: `${monthName} ${year}`,
  updated: new Date().toISOString().slice(0, 10),
  source: "Box Office Mojo",
  releases,
};

mkdirSync("data", { recursive: true });
const filename = `data/${monthName.toLowerCase()}-${year}.json`;
const payload = JSON.stringify(out, null, 2) + "\n";

let changed = true;
try {
  changed = readFileSync(filename, "utf8") !== payload;
} catch {}
writeFileSync(filename, payload);
console.log(`${changed ? "Updated" : "Unchanged"} ${filename} (${releases.length} releases)`);
