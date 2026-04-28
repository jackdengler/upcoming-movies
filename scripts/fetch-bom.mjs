#!/usr/bin/env node
// Fetches release data from Box Office Mojo's calendar — the authoritative
// list of what's actually booked into US theaters — and enriches each title
// via TMDB for fields BOM doesn't expose: director, budget, tagline, and a
// stable tmdb_id used as the frontend's movie key.
//
// BOM is gospel for the *date*, *distributor*, *Wide/Limited classification*,
// and the *re-release / anniversary* flag (BOM annotates Top Gun, Legally
// Blonde re-releases, etc. with a "<year> Re-release" or "Nth Anniversary"
// secondary label). Any row BOM marks that way is dropped — they belong in
// the rereleases tab, not new releases. As a backstop for unannotated
// re-releases (e.g. Harlan County U.S.A. 1976 listed without a label) we
// also drop films whose TMDB primary release_date year is more than 3 years
// before the calendar year. The threshold preserves festival-to-theatrical
// rollouts (festival 2024 → theatrical 2026 stays in).
//
// BOM's calendar page (`/calendar/<YYYY-MM-01>/`) is a single table that
// covers ~30 days starting from the URL date, with `<tr class="mojo-group-
// label">` rows acting as per-day section dividers. We walk the table top
// to bottom, tracking the most recent divider as the canonical date for
// each subsequent film row, and keep only rows whose date falls in the
// target month. A film occasionally appears under multiple dates (limited
// preview week → wide opening week); we de-dupe by release_id, preferring
// the row whose scale is "Wide" so the date reflects the actual theatrical
// opening rather than a preview screening.
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

const MONTH_NAMES = {
  January: "01", February: "02", March: "03", April: "04",
  May: "05", June: "06", July: "07", August: "08",
  September: "09", October: "10", November: "11", December: "12",
};

// "May 1, 2026" → "2026-05-01". Returns null on anything we don't recognize.
function parseDateHeader(text) {
  const m = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTH_NAMES[m[1]];
  if (!month) return null;
  return `${m[3]}-${month}-${String(+m[2]).padStart(2, "0")}`;
}

// Parse a single film row. Returns null for non-film rows (header, dividers).
function parseFilmRow(rowHtml) {
  const releaseLink = rowHtml.match(
    /<a[^>]+href="\/release\/(rl\d+)\/[^"]*"[^>]*>/i
  );
  if (!releaseLink) return null;

  const titleMatch = rowHtml.match(/<h3>([\s\S]*?)<\/h3>/i);
  if (!titleMatch) return null;
  const title = stripTags(titleMatch[1]);
  if (!title) return null;

  // BOM marks re-releases / anniversary screenings with a secondary label
  // directly under the title, e.g. "2026 Re-release (40th Anniversary)" or
  // "25th Anniversary". Either text is enough to classify the row as a
  // re-release and drop it from new-releases output.
  const isRerelease =
    /class="a-size-base a-color-secondary"[^>]*>[^<]*(?:Re-release|Anniversary)/i.test(
      rowHtml,
    );

  const imdbMatch = rowHtml.match(/pro\.imdb\.com\/title\/(tt\d+)/i);

  const studiosCellMatch = rowHtml.match(
    /<td[^>]*mojo-field-type-release_studios[^>]*>([\s\S]*?)<\/td>/i,
  );
  const distributorRaw = studiosCellMatch ? stripTags(studiosCellMatch[1]) : "";
  const distributor = distributorRaw && distributorRaw !== "-" ? distributorRaw : null;

  const scaleCellMatch = rowHtml.match(
    /<td[^>]*mojo-field-type-release_scale[^>]*>([\s\S]*?)<\/td>/i,
  );
  const scaleText = scaleCellMatch ? stripTags(scaleCellMatch[1]).toLowerCase() : "";
  const release_type = /\bwide\b/.test(scaleText) ? "wide" : "limited";

  const genresMatch = rowHtml.match(
    /<div class="a-section a-spacing-none mojo-schedule-genres">([\s\S]*?)<\/div>/i,
  );
  const genres = genresMatch
    ? stripTags(genresMatch[1])
        .split(/\s+/)
        .filter(Boolean)
    : [];

  const castMatch = rowHtml.match(
    /<span class="a-text-bold">With:\s*<\/span>([\s\S]*?)<\/div>/i,
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
    isRerelease,
  };
}

// Walk every <tr> in document order. Section-divider rows
// (class="mojo-group-label") update the running date; subsequent film
// rows inherit it. Keeps only rows whose date falls in the target month,
// drops BOM-flagged re-releases, and de-dupes by release_id with a Wide
// > Limited preference so a multi-stage release lands on its wide date.
function parseCalendar(html, targetMonth) {
  const byReleaseId = new Map();
  let currentDate = null;
  let dropped = 0;
  const rowRe = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowRe.exec(html))) {
    const trAttrs = match[1];
    const rowHtml = match[2];

    if (/mojo-group-label/.test(trAttrs)) {
      const headerMatch = rowHtml.match(
        /class="[^"]*mojo-table-header[^"]*"[^>]*>([\s\S]*?)<\/th>/i,
      );
      if (headerMatch) {
        const parsed = parseDateHeader(stripTags(headerMatch[1]));
        if (parsed) currentDate = parsed;
      }
      continue;
    }

    if (!currentDate) continue;
    if (currentDate.slice(0, 7) !== targetMonth) continue;

    const film = parseFilmRow(rowHtml);
    if (!film) continue;
    if (film.isRerelease) {
      dropped++;
      continue;
    }
    film.date = currentDate;

    const existing = byReleaseId.get(film.release_id);
    const preferIncoming =
      !existing ||
      (existing.release_type !== "wide" && film.release_type === "wide");
    if (preferIncoming) byReleaseId.set(film.release_id, film);
  }
  if (dropped) console.log(`Dropped ${dropped} BOM-flagged re-release(s).`);
  return [...byReleaseId.values()];
}

async function enrich(rows) {
  const calendarYear = +year;
  const out = [];
  let droppedRerelease = 0;
  for (const row of rows) {
    let tmdb_id = null;
    let director = "—";
    let budget_usd = null;
    let notes = "";
    let cast = row.bom_cast || "—";
    let genre = row.genres.length ? row.genres.join(" / ") : "—";
    let originalYear = null;

    if (row.imdb_id) {
      try {
        const find = await tmdbGet(`/find/${row.imdb_id}?external_source=imdb_id`);
        const movie = find.movie_results?.[0];
        if (movie) {
          tmdb_id = movie.id;
          await sleep(35);
          const d = await tmdbGet(
            `/movie/${movie.id}?append_to_response=credits`,
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
        }
        await sleep(35);
      } catch (e) {
        console.warn(`TMDB enrich ${row.imdb_id} (${row.title}): ${e.message}`);
      }
    }

    // Backstop for re-releases BOM didn't annotate (e.g. Harlan County
    // U.S.A. (1976) appearing on the calendar with no Re-release tag).
    if (
      originalYear !== null &&
      originalYear < calendarYear - RERELEASE_YEAR_THRESHOLD
    ) {
      console.log(`Drop unannotated re-release: ${row.title} (${originalYear})`);
      droppedRerelease++;
      continue;
    }

    out.push({
      tmdb_id,
      date: row.date,
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
  if (droppedRerelease)
    console.log(`Dropped ${droppedRerelease} TMDB-year re-release(s).`);
  return out;
}

const calendarUrl = `https://www.boxofficemojo.com/calendar/${year}-${mm}-01/`;
const html = await bomGet(calendarUrl);
const bomRows = parseCalendar(html, MONTH);
console.log(`BOM: ${bomRows.length} listing(s) for ${MONTH}`);

const releases = await enrich(bomRows);
releases.sort(
  (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
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
