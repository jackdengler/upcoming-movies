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

async function get(path) {
  const r = await fetch(`${API}${path}`, { headers });
  if (!r.ok) throw new Error(`TMDB ${r.status} ${path}`);
  return r.json();
}

async function discover() {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const q = new URLSearchParams({
      region: "US",
      with_release_type: "2|3",
      without_genres: "99,10402",
      "primary_release_date.gte": start,
      "primary_release_date.lte": end,
      sort_by: "primary_release_date.asc",
      page: String(page),
    });
    const j = await get(`/discover/movie?${q}`);
    out.push(...(j.results || []));
    if (page >= (j.total_pages || 1)) break;
  }
  return out;
}

function classify(releaseDates) {
  const us = (releaseDates?.results || []).find((r) => r.iso_3166_1 === "US");
  if (!us) return { type: "wide", date: null };
  const entries = [...us.release_dates]
    .filter((r) => [2, 3, 4, 6].includes(r.type))
    .sort((a, b) => a.release_date.localeCompare(b.release_date));
  const first = entries[0];
  if (!first) return { type: "wide", date: null };
  const hasWide = entries.some((e) => e.type === 3);
  const type = hasWide
    ? "wide"
    : first.type === 2
    ? "limited"
    : first.type === 4 || first.type === 6
    ? "streaming"
    : "wide";
  return { type, date: first.release_date.slice(0, 10) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await discover();
const releases = [];
for (const m of list) {
  try {
    const d = await get(`/movie/${m.id}?append_to_response=credits,release_dates`);
    const genreIds = (d.genres || []).map((g) => g.id);
    if (genreIds.includes(99) || genreIds.includes(10402)) continue;
    const cls = classify(d.release_dates);
    const date = cls.date || d.release_date || m.release_date;
    if (!date || date.slice(0, 7) !== MONTH) continue;
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
      date,
      title: d.title,
      director,
      studio,
      budget_usd: d.budget || null,
      release_type: cls.type,
      genre: (d.genres || []).map((g) => g.name).join(" / ") || "—",
      cast,
      notes: d.tagline || "",
    });
    await sleep(40);
  } catch (e) {
    console.warn(`skip ${m.id} ${m.title}: ${e.message}`);
  }
}

releases.sort(
  (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)
);

const monthName = new Date(`${start}T12:00:00Z`).toLocaleString("en-US", {
  month: "long",
});
const out = {
  month: `${monthName} ${year}`,
  updated: new Date().toISOString().slice(0, 10),
  source: "TMDB",
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
console.log(
  `${changed ? "Updated" : "Unchanged"} ${filename} (${releases.length} releases)`
);
