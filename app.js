import * as Interests from "./js/interests.js";
import * as Activity from "./js/activity.js";
import * as Directors from "./js/directors.js";
import * as Studios from "./js/studios.js";
import * as Tmdb from "./js/tmdb.js";

// When loaded inside an iframe (e.g. the central-optimus launcher), the
// host already absorbs the device's notch/home-indicator insets. iOS
// WebKit still exposes env(safe-area-inset-*) to the iframe, so without
// this flag the header and tab bar reserve that space a SECOND time —
// producing visible bands of dead space above "Upcoming" and below the
// tab bar. Tagging :root lets the stylesheet zero --safe-top /
// --safe-bottom only when embedded, leaving standalone PWA mode alone.
try {
  if (window.self !== window.top) {
    document.documentElement.classList.add("embedded");
  }
} catch {
  // Cross-origin access to window.top throws in some hosts — that itself
  // is a reliable signal we're inside a foreign iframe.
  document.documentElement.classList.add("embedded");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      reg.update().catch(() => {});
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
      });
    } catch {}
  });
}

const now = new Date();
const YEAR = now.getFullYear();
const TODAY = `${YEAR}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const CURRENT_MONTH_KEY = `${YEAR}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const NEXT_MONTH_KEY = (() => {
  const d = new Date(YEAR, now.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
})();

const LEVELS = ["watched", "booked", "must", "likely", "potential", "not"];
const LEVEL_LABEL = {
  must: "Must",
  likely: "Likely",
  booked: "Booked",
  potential: "Unlikely",
  not: "Skip",
  watched: "Seen",
};

const ACTIVE_KIND_KEY = "upcoming:active-kind";
const ACTIVE_SCOPE_KEY = "upcoming:active-scope";
const AMC_LOCAL_ONLY_KEY = "upcoming:amc-local-only";
const HIDE_SKIPPED_KEY = "upcoming:hide-skipped";
const LEGACY_CALENDAR_KIND_KEY = "upcoming:calendar-kinds";
const EXPANDED_KEY = "upcoming:expanded";
const INTEREST_EXPANDED_KEY = "upcoming:interest-expanded";

// Single source of truth for the New Releases ↔ Rereleases flip. Applies to
// the List tab, the Calendar, and the Updates overlay. One-time migration
// from the old per-Calendar chip state: if the legacy object had exactly one
// kind enabled, prefer that; otherwise default to "releases".
let activeKind = (() => {
  try {
    const saved = localStorage.getItem(ACTIVE_KIND_KEY);
    if (saved === "releases" || saved === "rereleases") return saved;
  } catch {}
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_CALENDAR_KIND_KEY) || "null");
    localStorage.removeItem(LEGACY_CALENDAR_KIND_KEY);
    if (legacy && typeof legacy === "object") {
      if (legacy.rereleases && !legacy.releases) return "rereleases";
    }
  } catch {}
  return "releases";
})();
const saveActiveKind = () => {
  try { localStorage.setItem(ACTIVE_KIND_KEY, activeKind); } catch {}
};

// Scope filter for the New Releases view: "both" | "wide" | "limited".
// Applied to the List and Calendar tabs only — Interests and Updates show
// every marked/changed item regardless of current scope.
let activeScope = (() => {
  try {
    const saved = localStorage.getItem(ACTIVE_SCOPE_KEY);
    if (saved === "both" || saved === "wide" || saved === "limited") return saved;
  } catch {}
  return "both";
})();
const saveActiveScope = () => {
  try { localStorage.setItem(ACTIVE_SCOPE_KEY, activeScope); } catch {}
};
const matchesScope = (m) =>
  activeScope === "both" || (m.release_type || "wide") === activeScope;

// "Only at my AMCs" toggle for the New Releases view: when on, hide releases
// whose normalized title isn't in the AMC first-run title set scraped from
// the user's preferred AMC theatres. AMC posts showtimes only ~1–2 weeks
// ahead, so this is a soft view-mode rather than a guarantee — users
// understand they're filtering to "what AMC has actually scheduled so far."
let amcLocalOnly = (() => {
  try { return localStorage.getItem(AMC_LOCAL_ONLY_KEY) === "1"; }
  catch { return false; }
})();
const saveAmcLocalOnly = () => {
  try { localStorage.setItem(AMC_LOCAL_ONLY_KEY, amcLocalOnly ? "1" : "0"); } catch {}
};
// Populated from repertoryState.data.amc_local_titles after load.
const amcLocalTitles = new Set();
const matchesAmcLocal = (m) => {
  if (!amcLocalOnly) return true;
  if (!amcLocalTitles.size) return false;
  return amcLocalTitles.has(slugifyClient(m.title || ""));
};

// "Hide skipped" toggle: when on, drop releases the user has marked
// as "not" (Skip) from the List + Calendar views. Same scoping as the
// AMC toggle — Interests/Updates always show every marked item.
let hideSkipped = (() => {
  try { return localStorage.getItem(HIDE_SKIPPED_KEY) === "1"; }
  catch { return false; }
})();
const saveHideSkipped = () => {
  try { localStorage.setItem(HIDE_SKIPPED_KEY, hideSkipped ? "1" : "0"); } catch {}
};
const matchesNotSkipped = (m) =>
  !hideSkipped || Interests.getLevel(movieKey(m)) !== "not";

// Free-text filter for the List tab (releases + rereleases). Not persisted —
// each session starts clean to avoid leaving the list in a confusing,
// half-empty state across reloads.
let searchQuery = "";
const normalizeQuery = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const releaseHaystack = (m) =>
  normalizeQuery([m.title, m.director, m.cast, m.studio, m.genre, m.notes]
    .filter(Boolean).join(" "));

const repEntryHaystack = (entry) =>
  normalizeQuery([
    entry.title,
    entry.year,
    entry.format,
    entry.series,
    [...entry.theaters].join(" "),
  ].filter(Boolean).join(" "));

const matchesQuery = (haystack) => {
  if (!searchQuery) return true;
  const q = searchQuery;
  if (!q) return true;
  // All space-separated terms must match somewhere — lets users combine
  // "scorsese 2026" or "horror limited" without committing to one field.
  for (const term of q.split(" ")) {
    if (term && !haystack.includes(term)) return false;
  }
  return true;
};

const matchesReleaseQuery = (m) => matchesQuery(releaseHaystack(m));
const matchesRepEntryQuery = (entry) => matchesQuery(repEntryHaystack(entry));

const expanded = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPANDED_KEY) || "null");
    if (saved && typeof saved === "object") return saved;
  } catch {}
  return {};
})();
const saveExpanded = () => {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded)); } catch {}
};

const interestExpanded = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(INTEREST_EXPANDED_KEY) || "null");
    if (saved && typeof saved === "object") return saved;
  } catch {}
  return {};
})();
const saveInterestExpanded = () => {
  try { localStorage.setItem(INTEREST_EXPANDED_KEY, JSON.stringify(interestExpanded)); } catch {}
};

const fmtDateShort = (iso) => {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric" });
};

const fmtBudget = (usd, note) => {
  if (usd == null || usd === 0) return "Undisclosed";
  const m = usd / 1_000_000;
  const base = m >= 100 ? `$${Math.round(m)}M` : `$${m.toFixed(m < 10 ? 1 : 0)}M`;
  return note ? `${base} · ${note}` : base;
};

const chipClass = (type) =>
  type === "limited" ? "chip chip--limited" :
  type === "streaming" ? "chip chip--streaming" :
  "chip";

const chipLabel = (type) =>
  type === "streaming" ? "Streaming" :
  type === "limited" ? "Limited" : "Wide";

const wikipediaUrl = (title, date) => {
  const year = date ? date.slice(0, 4) : "";
  const q = `${title} ${year} film`.trim();
  return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q)}&go=Go`;
};

const movieKey = (m) => (m.tmdb_id ? `tmdb:${m.tmdb_id}` : `ttl:${m.title}:${m.date}`);

const slugifyClient = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const screeningKey = (s) => `rep:${s.theater}:${s.date}:${slugifyClient(s.title)}`;
const itemKey = (item) =>
  item?._kind === "screening" ? screeningKey(item) : movieKey(item);

// Rereleases interest is stored at the (title, month) granularity. The same
// title playing at multiple theaters in the same month rolls up to one mark,
// so marking "Training Day, April" once applies to every showtime that month
// regardless of which theater(s) host it. A re-run a year later gets a new
// month key and starts fresh.
//
// Each mark is an object:
//   {
//     interest: "yes" | "no" | null,
//     booked:   { date, time, theater } | null,
//     watched:  { date, time, theater } | null,
//     meta:     { title, year, format, series } | null,  // for display when
//                                                          screening data has
//                                                          rotated past
//   }
const repTitleMonthId = (s) =>
  `${slugifyClient(s.title)}|${(s.date || "").slice(0, 7)}`;

const REP_MARKS_KEY = "upcoming:rereleases-marks";
const REP_MARKS_KEY_LEGACY = "upcoming:rereleases-interest"; // superseded

function stripTheaterFromRepId(id) {
  // Old keys looked like "theater|slug|YYYY-MM"; new keys are "slug|YYYY-MM".
  const parts = String(id).split("|");
  if (parts.length === 3) return `${parts[1]}|${parts[2]}`;
  return id;
}

function normalizeRepMarkValue(value) {
  if (typeof value === "string") {
    return { interest: value === "yes" || value === "no" ? value : null,
             booked: null, watched: null, meta: null };
  }
  if (value && typeof value === "object") {
    const interest = value.interest === "yes" || value.interest === "no" ? value.interest : null;
    return {
      interest,
      booked: value.booked || null,
      watched: value.watched || null,
      meta: value.meta || null,
    };
  }
  return null;
}

function mergeRepMarkInto(target, incoming) {
  if (!incoming) return target;
  if (!target) return { ...incoming };
  // "yes" wins over "no" (we'd rather over-show than under-show).
  if (incoming.interest === "yes") target.interest = "yes";
  else if (!target.interest && incoming.interest) target.interest = incoming.interest;
  if (!target.booked && incoming.booked) target.booked = incoming.booked;
  if (!target.watched && incoming.watched) target.watched = incoming.watched;
  if (!target.meta && incoming.meta) target.meta = incoming.meta;
  return target;
}

const repMarks = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(REP_MARKS_KEY) || "null");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      const out = {};
      for (const [key, value] of Object.entries(saved)) {
        const newKey = stripTheaterFromRepId(key);
        const norm = normalizeRepMarkValue(value);
        if (!norm) continue;
        out[newKey] = mergeRepMarkInto(out[newKey], norm);
      }
      return out;
    }
  } catch {}
  // One-time migration: legacy key stored a Set of interested IDs only.
  try {
    const legacy = JSON.parse(localStorage.getItem(REP_MARKS_KEY_LEGACY) || "null");
    if (Array.isArray(legacy)) {
      const out = {};
      for (const id of legacy) {
        const newKey = stripTheaterFromRepId(id);
        out[newKey] = mergeRepMarkInto(out[newKey], {
          interest: "yes", booked: null, watched: null, meta: null,
        });
      }
      try { localStorage.setItem(REP_MARKS_KEY, JSON.stringify(out)); } catch {}
      return out;
    }
  } catch {}
  return {};
})();
// Share the in-memory map with interests.js so remote sync can merge updates
// from other devices and commit local changes alongside the new-release marks.
Interests.bindRepMarks(repMarks);

const saveRepMarks = () => {
  try { localStorage.setItem(REP_MARKS_KEY, JSON.stringify(repMarks)); } catch {}
  Interests.notifyRepChange();
};
const getRepMark = (id) => repMarks[id] || null;
const getRepInterest = (id) => repMarks[id]?.interest || null;
const getRepBooked = (id) => repMarks[id]?.booked || null;
const getRepWatched = (id) => repMarks[id]?.watched || null;

const stampRepMark = (id) => {
  if (repMarks[id]) repMarks[id].at = new Date().toISOString();
};

function ensureRepMark(id, meta) {
  if (!repMarks[id]) {
    repMarks[id] = { interest: null, booked: null, watched: null, meta: meta || null, at: null };
  } else if (meta && !repMarks[id].meta) {
    repMarks[id].meta = meta;
  }
  return repMarks[id];
}

function pruneRepMark(id) {
  const m = repMarks[id];
  if (!m) return;
  if (!m.interest && !m.booked && !m.watched) delete repMarks[id];
}

function setRepInterest(id, value, meta) {
  if (value !== "yes" && value !== "no" && value !== null) return;
  if (value === null) {
    if (repMarks[id]) {
      repMarks[id].interest = null;
      stampRepMark(id);
      pruneRepMark(id);
    }
  } else {
    ensureRepMark(id, meta).interest = value;
    stampRepMark(id);
  }
  saveRepMarks();
}

function setRepBooked(id, booked, meta) {
  if (booked === null) {
    if (repMarks[id]) {
      repMarks[id].booked = null;
      stampRepMark(id);
      pruneRepMark(id);
    }
  } else {
    ensureRepMark(id, meta).booked = booked;
    stampRepMark(id);
  }
  saveRepMarks();
}

function setRepWatched(id, watched, meta) {
  if (watched === null) {
    if (repMarks[id]) {
      repMarks[id].watched = null;
      stampRepMark(id);
      pruneRepMark(id);
    }
  } else {
    ensureRepMark(id, meta).watched = watched;
    stampRepMark(id);
  }
  saveRepMarks();
}

// Export-dialog flags persisted on the rep mark itself so they ride the
// same GitHub sync and stick across opens.
function setRepExportFlags(id, { starred, excluded } = {}) {
  if (!repMarks[id]) return;
  let changed = false;
  if (typeof starred === "boolean" && repMarks[id].starred !== starred) {
    repMarks[id].starred = starred;
    changed = true;
  }
  if (typeof excluded === "boolean" && repMarks[id].excluded !== excluded) {
    repMarks[id].excluded = excluded;
    changed = true;
  }
  if (changed) {
    stampRepMark(id);
    saveRepMarks();
  }
}

const fmtTime = (hhmm) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${period}`;
};

const monthFilename = (year, monthIdx) => {
  const d = new Date(year, monthIdx, 1);
  const monthName = d.toLocaleString("en-US", { month: "long" }).toLowerCase();
  return `./data/${monthName}-${year}.json`;
};

async function loadYear(year) {
  const urls = Array.from({ length: 12 }, (_, i) => monthFilename(year, i));
  const results = await Promise.all(
    urls.map((u) => fetch(u)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null))
  );
  return results.filter(Boolean);
}

async function loadRepertory() {
  try {
    const r = await fetch("./data/repertory.json");
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "open") { if (v) n.setAttribute("open", ""); }
    else if (k === "hidden") { if (v) n.setAttribute("hidden", ""); }
    else if (k === "dataset") Object.assign(n.dataset, v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return n;
};

const groupByDate = (rows) => {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.date)) map.set(r.date, []);
    map.get(r.date).push(r);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
};

const monthKeyOf = (bundle) => bundle.releases[0]?.date.slice(0, 7) || "";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const monthLabel = (year, monthIdx) => `${MONTH_NAMES[monthIdx]} ${year}`;
const pad2 = (n) => String(n).padStart(2, "0");
const dateKey = (year, monthIdx, day) => `${year}-${pad2(monthIdx + 1)}-${pad2(day)}`;

// ---------- Row rendering ----------

function baseMeta(item) {
  if (item._kind === "screening") {
    return {
      kind: "screening",
      title: item.title,
      date: item.date,
      theater: item.theater,
      time: item.time,
      format: item.format || null,
      series: item.series || null,
      url: item.url || null,
    };
  }
  return { title: item.title, date: item.date, tmdb_id: item.tmdb_id || null };
}

// Trailer ids from the data fetcher; openTrailers tracks which rows are
// currently expanded inline so re-renders preserve the playing state.
const openTrailers = new Set();

const youtubeSearchUrl = (title, year) => {
  const q = `${title || ""} ${year || ""} trailer`.trim();
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
};

function trailerEmbedUrl(videoId) {
  // youtube-nocookie keeps the standalone PWA from leaking into the user's
  // YouTube history. autoplay=1 fires once the iframe mounts because we only
  // append the iframe in response to a user tap (gesture-allowed).
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
}

function renderTrailer({ key, title, year, ytId }) {
  const open = openTrailers.has(key);

  if (!ytId) {
    return el("div", { class: "row__trailer-row" },
      el("a", {
          class: "row__trailer-btn",
          href: youtubeSearchUrl(title, year),
          target: "_blank",
          rel: "noopener noreferrer",
          dataset: { trailerSearch: "1" },
        },
        el("span", { text: "Search trailer" }),
      ),
    );
  }

  const btn = el("button", {
      type: "button",
      class: `row__trailer-btn${open ? " is-on" : ""}`,
      "aria-pressed": open ? "true" : "false",
      "aria-expanded": open ? "true" : "false",
      dataset: { trailerToggle: "1", key, yt: ytId },
    },
    el("span", { text: open ? "Hide trailer" : "Trailer" }),
  );

  const wrap = el("div", { class: "row__trailer", dataset: { trailerWrap: key } },
    el("div", { class: "row__trailer-row" }, btn),
  );

  if (open) {
    const frame = el("div", { class: "row__trailer-frame" },
      el("iframe", {
        src: trailerEmbedUrl(ytId),
        allow: "autoplay; encrypted-media; picture-in-picture; web-share",
        allowfullscreen: "",
        loading: "lazy",
        referrerpolicy: "strict-origin-when-cross-origin",
        title: `${title || "Trailer"} trailer`,
      }),
    );
    wrap.appendChild(frame);
  }

  return wrap;
}

// Split-rendering variant for new-release rows: returns the play-icon button
// (placed inline in the title row) and a separate frame wrapper (mounted at
// the bottom of the card) so the iframe stays below the metadata. Returns
// null entries when no trailer data is available.
// SVG glyphs sit inside the mini play/stop button. Both are always rendered;
// CSS swaps which one is visible based on `.is-on`. Crisper than the old
// border-triangle hack at small sizes and inherits `currentColor` so the
// icon flips with the button's text color.
const MINI_TRAILER_ICONS = `
  <svg class="row__trailer-glyph row__trailer-glyph--play" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8.25 4.94a1 1 0 0 1 1.5-.87l11 6.93a1 1 0 0 1 0 1.69l-11 6.93a1 1 0 0 1-1.5-.87V4.94z"/>
  </svg>
  <svg class="row__trailer-glyph row__trailer-glyph--stop" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="1.5"/>
  </svg>
`;

function renderInlineTrailer({ key, title, year, ytId }) {
  const open = openTrailers.has(key);
  const ariaLabel = ytId
    ? (open ? "Hide trailer" : "Play trailer")
    : "Search trailer on YouTube";

  if (!ytId) {
    const button = el("a", {
        class: "row__trailer-btn row__trailer-btn--mini",
        href: youtubeSearchUrl(title, year),
        target: "_blank",
        rel: "noopener noreferrer",
        "aria-label": ariaLabel,
        title: ariaLabel,
        dataset: { trailerSearch: "1" },
      },
    );
    button.innerHTML = MINI_TRAILER_ICONS;
    return { button, frameWrap: null };
  }

  const button = el("button", {
      type: "button",
      class: `row__trailer-btn row__trailer-btn--mini${open ? " is-on" : ""}`,
      "aria-pressed": open ? "true" : "false",
      "aria-expanded": open ? "true" : "false",
      "aria-label": ariaLabel,
      title: ariaLabel,
      dataset: { trailerToggle: "1", key, yt: ytId },
    },
  );
  button.innerHTML = MINI_TRAILER_ICONS;

  const frameWrap = el("div", {
    class: "row__trailer",
    dataset: { trailerWrap: key },
  });

  if (open) {
    const frame = el("div", { class: "row__trailer-frame" },
      el("iframe", {
        src: trailerEmbedUrl(ytId),
        allow: "autoplay; encrypted-media; picture-in-picture; web-share",
        allowfullscreen: "",
        loading: "lazy",
        referrerpolicy: "strict-origin-when-cross-origin",
        title: `${title || "Trailer"} trailer`,
      }),
    );
    frameWrap.appendChild(frame);
  }

  return { button, frameWrap };
}

function renderInlineTrailerSection(m) {
  return renderInlineTrailer({
    key: movieKey(m),
    title: m.title,
    year: (m.date || "").slice(0, 4) || null,
    ytId: m.youtube_trailer_id || null,
  });
}

function renderTrailerSection(m) {
  return renderTrailer({
    key: movieKey(m),
    title: m.title,
    year: (m.date || "").slice(0, 4) || null,
    ytId: m.youtube_trailer_id || null,
  });
}

function renderRepTrailerSection(entry) {
  // Group-level entries don't carry a single date, but every showing in the
  // run shares the same film. Pick the first showing that has a baked
  // `youtube_trailer_id` so screenings with stale data still get picked up.
  const ytId =
    entry.showings.find((s) => s.youtube_trailer_id)?.youtube_trailer_id || null;
  return renderTrailer({
    key: entry.id,
    title: entry.title,
    year: entry.year,
    ytId,
  });
}

function renderRatingBar(m) {
  const key = itemKey(m);
  const level = Interests.getLevel(key);
  const bar = el("div", { class: "rating", role: "group", "aria-label": "Interest level" },
    ...LEVELS.map((lv) =>
      el("button", {
          type: "button",
          class: `rating__btn rating__btn--${lv}${level === lv ? " is-active" : ""}`,
          "data-level": lv,
          "aria-pressed": level === lv ? "true" : "false",
        },
        LEVEL_LABEL[lv]
      )
    ),
  );

  bar.addEventListener("click", async (e) => {
    const btn = e.target.closest(".rating__btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const lvl = btn.dataset.level;
    if (!Interests.hasPat()) {
      const saved = await requestPat();
      if (!saved) return;
    }
    const current = Interests.getLevel(key);

    if (lvl === "booked") {
      const existing = Interests.getMark(key);
      const result = await requestDateDialog({
        heading: "Book ticket",
        copy: m.title ? `Pick the date you're seeing ${m.title}.` : "Pick the date you're seeing it.",
        defaultDate: existing?.booked_date || m.date || TODAY,
        isUpdate: current === "booked",
      });
      if (result.action === "cancel") return;
      if (result.action === "remove") {
        Interests.set(key, null);
        return;
      }
      Interests.set(key, "booked", {
        ...baseMeta(m),
        booked_date: result.date,
      });
      return;
    }

    if (lvl === "watched") {
      const existing = Interests.getMark(key);
      const result = await requestDateDialog({
        heading: "Mark watched",
        copy: m.title ? `When did you see ${m.title}?` : "When did you see it?",
        defaultDate: existing?.watched_date || existing?.booked_date || m.date || TODAY,
        isUpdate: current === "watched",
      });
      if (result.action === "cancel") return;
      if (result.action === "remove") {
        Interests.set(key, null);
        return;
      }
      Interests.set(key, "watched", {
        ...baseMeta(m),
        watched_date: result.date,
      });
      return;
    }

    Interests.set(key, current === lvl ? null : lvl, baseMeta(m));
  });

  return bar;
}

function renderRow(m, opts = {}) {
  const key = movieKey(m);
  const level = Interests.getLevel(key);

  const titleLink = el("a", {
      class: "row__titlelink",
      href: wikipediaUrl(m.title, m.date),
      target: "_blank",
      rel: "noopener noreferrer",
    },
    m.title,
  );

  const metaBits = [];
  if (opts.showDate && m.date) metaBits.push(fmtDateShort(m.date));
  if (m.genre) metaBits.push(m.genre);
  const meta = metaBits.join(" · ");

  const { button: trailerBtn, frameWrap: trailerFrame } = renderInlineTrailerSection(m);

  const hasBudget = m.budget_usd != null && m.budget_usd !== 0;

  return el("div", {
      class: `row${level ? ` row--${level}` : ""}`,
      dataset: { key },
    },
    el("div", { class: "row__title-line" },
      el("h3", { class: "row__title" }, titleLink),
      el("div", { class: "row__title-right" },
        trailerBtn,
        el("div", { class: "row__chips" },
          el("span", { class: chipClass(m.release_type), text: chipLabel(m.release_type) }),
        ),
      ),
    ),
    meta ? el("div", { class: "row__meta", text: meta }) : null,
    el("dl", { class: "row__sub" },
      el("dt", { text: "Director" }), el("dd", { text: m.director }),
      el("dt", { text: "Studio" }), el("dd", { text: m.studio }),
      hasBudget ? el("dt", { text: "Budget" }) : null,
      hasBudget ? el("dd", { text: fmtBudget(m.budget_usd, m.budget_note) }) : null,
      m.cast && m.cast !== "—" ? el("dt", { text: "Cast" }) : null,
      m.cast && m.cast !== "—" ? el("dd", { text: m.cast }) : null,
    ),
    trailerFrame,
    renderRatingBar(m),
  );
}

// ---------- Screening row rendering ----------

function renderScreening(s, opts = {}) {
  const item = { ...s, _kind: "screening" };
  const key = screeningKey(s);
  const level = Interests.getLevel(key);
  const mark = Interests.getMark(key);

  const theaterMeta = repertoryState.theatersBySlug.get(s.theater);
  const theaterName = theaterMeta?.name || s.theater;
  const linkUrl = s.url || theaterMeta?.url || wikipediaUrl(s.title, `${s.year || ""}-01-01`);

  const titleLink = el("a", {
      class: "row__titlelink",
      href: linkUrl,
      target: "_blank",
      rel: "noopener noreferrer",
    },
    s.title || "Untitled",
  );

  const dateLine = opts.showDate
    ? `${fmtDateShort(s.date)} · ${fmtTime(s.time)}`
    : fmtTime(s.time);

  const bookedBadge = level === "booked" && mark?.booked_date
    ? el("div", { class: "row__booked", text: `🎟  Booked for ${fmtDateShort(mark.booked_date)}` })
    : null;
  const watchedBadge = level === "watched" && mark?.watched_date
    ? el("div", { class: "row__watched", text: `✓  Watched ${fmtDateShort(mark.watched_date)}` })
    : null;

  const titleNode = el("h3", { class: "row__title" }, titleLink);
  if (s.format) {
    titleNode.appendChild(el("span", { class: "chip--format", text: s.format }));
  }
  if (s.year) {
    titleNode.appendChild(
      el("span", { class: "row__meta", text: ` (${s.year})` })
    );
  }

  return el("div", {
      class: `row${level ? ` row--${level}` : ""}`,
      dataset: { key },
    },
    el("div", { class: "row__title-line" },
      titleNode,
      el("div", { class: "row__chips" },
        el("span", { class: "chip--theater", text: theaterName }),
      ),
    ),
    el("div", { class: "row__time", text: dateLine }),
    s.series ? el("div", { class: "row__series", text: s.series }) : null,
    bookedBadge,
    watchedBadge,
    renderRatingBar(item),
  );
}

// ---------- Month/date rendering ----------

function renderDateGroup([date, items]) {
  return el("section", { class: "section" },
    el("header", { class: "section__header" },
      el("span", { class: "section__date", text: fmtDateShort(date) }),
      el("span", { class: "section__count", text: `${items.length}` }),
    ),
    el("div", { class: "section__list" }, ...items.map(renderRow)),
  );
}

function renderMonth(bundle) {
  const key = monthKeyOf(bundle);
  const filtered = bundle.releases.filter(
    (m) => matchesScope(m) && matchesAmcLocal(m) && matchesNotSkipped(m) && matchesReleaseQuery(m)
  );
  if (!filtered.length) return null;

  const defaultOpen = key === CURRENT_MONTH_KEY || key === NEXT_MONTH_KEY;
  // Active search forces every surviving month open so matches are visible
  // without an extra tap to expand each section.
  const open = searchQuery
    ? true
    : (key in expanded ? expanded[key] : defaultOpen);
  const isPast = key < CURRENT_MONTH_KEY;
  const groups = groupByDate(filtered);

  const details = el("details", {
      class: isPast ? "month month--past" : "month",
      open,
      dataset: { monthKey: key },
    },
    el("summary", { class: "month__summary" },
      el("span", { class: "month__chevron", "aria-hidden": "true" }),
      el("span", { class: "month__name", text: bundle.month }),
      el("span", { class: "month__count", text: `${filtered.length}` }),
    ),
    el("div", { class: "month__body" }, ...groups.map(renderDateGroup)),
  );

  details.addEventListener("toggle", () => {
    expanded[key] = details.open;
    saveExpanded();
  });
  // Backup: capture summary taps in case toggle event doesn't fire
  // consistently (seen on iOS standalone PWA edge cases).
  const summary = details.querySelector(".month__summary");
  if (summary) {
    summary.addEventListener("click", () => {
      requestAnimationFrame(() => {
        expanded[key] = details.open;
        saveExpanded();
      });
    });
  }

  return details;
}

function sortMonthOrder(bundles) {
  const past = [];
  const rest = [];
  for (const b of bundles) {
    (monthKeyOf(b) < CURRENT_MONTH_KEY ? past : rest).push(b);
  }
  rest.sort((a, b) => monthKeyOf(a).localeCompare(monthKeyOf(b)));
  past.sort((a, b) => monthKeyOf(a).localeCompare(monthKeyOf(b)));
  return [...rest, ...past];
}

// ---------- Interests tab rendering ----------

function renderInterestsTab(bundles) {
  if (activeKind === "rereleases") {
    renderRereleasesInterestsTab();
    return;
  }
  renderReleasesInterestsTab(bundles);
}

// SF-Symbols-style line icons for the Interests tab category cards.
// Monochrome, secondary text color — color cue is the card's left edge stripe.
const INTEREST_ICONS = {
  must:
    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1L3.2 9.7l6.1-.9z"/></svg>',
  likely:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  booked:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/>' +
    '<path d="M9 6v12" stroke-dasharray="2.5 2.5"/></svg>',
  potential:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6 3h12M6 21h12"/>' +
    '<path d="M7 3v3a5 5 0 0 0 5 5 5 5 0 0 1 5 5v3"/>' +
    '<path d="M17 3v3a5 5 0 0 1-5 5 5 5 0 0 0-5 5v3"/></svg>',
  not:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  watched:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  interested:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1L3.2 9.7l6.1-.9z"/></svg>',
  already_shown:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/></svg>',
};

const interestIconNode = (level) => {
  const svg = INTEREST_ICONS[level];
  if (!svg) return null;
  const span = document.createElement("span");
  span.className = "interest-group__icon";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = svg;
  return span;
};

function renderReleasesInterestsTab(bundles) {
  const list = document.getElementById("interest-list");
  list.innerHTML = "";

  const allMovies = bundles.flatMap((b) => b.releases);
  const byKey = new Map(allMovies.map((m) => [movieKey(m), m]));
  const screenings = repertoryState.data?.screenings || [];
  const byScreeningKey = new Map(screenings.map((s) => [screeningKey(s), s]));

  const marks = Interests.allMarks();
  const grouped = { watched: [], booked: [], must: [], likely: [], potential: [], not: [] };

  for (const [key, meta] of Object.entries(marks)) {
    if (!grouped[meta.level]) continue;
    const isScreening = key.startsWith("rep:") || meta.kind === "screening";
    if (activeKind === "releases" && isScreening) continue;
    if (activeKind === "rereleases" && !isScreening) continue;

    if (isScreening) {
      const screening = byScreeningKey.get(key) || {
        theater: meta.theater || "unknown",
        title: meta.title || "Unknown",
        year: null,
        date: meta.date || "",
        time: meta.time || "",
        format: meta.format || null,
        series: meta.series || null,
        url: meta.url || null,
      };
      grouped[meta.level].push({ ...screening, _kind: "screening" });
      continue;
    }

    const movie = byKey.get(key) || {
      title: meta.title || "Unknown",
      date: meta.date || "",
      director: "—",
      studio: "—",
      budget_usd: null,
      release_type: "wide",
      genre: "",
      cast: "—",
      tmdb_id: meta.tmdb_id || null,
    };
    grouped[meta.level].push(movie);
  }

  const order = ["watched", "booked", "must", "likely", "potential", "not"];
  const titles = {
    must: "Must watch",
    likely: "Likely watch",
    booked: "Booked",
    potential: "Unlikely",
    not: "Not interested",
    watched: "Watched",
  };

  const empty = document.getElementById("empty-interests");
  const total = order.reduce((a, k) => a + grouped[k].length, 0);
  if (!total) {
    empty.textContent = "Swipe any movie on the List tab to mark interest.";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const lv of order) {
    const items = grouped[lv];
    if (!items.length) continue;
    if (lv === "booked") {
      items.sort((a, b) => {
        const am = Interests.getMark(itemKey(a))?.booked_date || a.date || "";
        const bm = Interests.getMark(itemKey(b))?.booked_date || b.date || "";
        return am.localeCompare(bm);
      });
    } else {
      items.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    }

    const renderItem = (m) =>
      m._kind === "screening"
        ? renderScreening(m, { showDate: true })
        : renderRow(m, { showDate: true });

    const open = lv in interestExpanded ? interestExpanded[lv] : true;
    const details = el("details", {
        class: `month interest-group interest-group--${lv}`,
        open,
        dataset: { level: lv },
      },
      el("summary", { class: "month__summary" },
        interestIconNode(lv),
        el("span", { class: "month__name", text: titles[lv] }),
        el("span", { class: "month__count", text: `${items.length}` }),
        el("span", { class: "month__chevron", "aria-hidden": "true" }),
      ),
      el("div", { class: "month__body" },
        el("div", { class: "section" },
          el("div", { class: "section__list" }, ...items.map(renderItem)),
        )
      )
    );

    details.addEventListener("toggle", () => {
      interestExpanded[lv] = details.open;
      saveInterestExpanded();
    });
    const summary = details.querySelector(".month__summary");
    if (summary) {
      summary.addEventListener("click", () => {
        requestAnimationFrame(() => {
          interestExpanded[lv] = details.open;
          saveInterestExpanded();
        });
      });
    }

    list.appendChild(details);
  }
}

// ---------- Rereleases Interests tab ----------

// Group every rep mark into Interested / Watched / Already shown / Not
// interested.
// - "watched" if the user explicitly marked it seen
// - "already_shown" if the run has no more upcoming showings (regardless of
//                   whether the user said yes or no — once it's gone, it
//                   shouldn't clutter Interested/Not interested)
// - "not" if interest === "no" and the run still has upcoming showings
// - "interested" if interest === "yes" (or a lone booking) and the run still
//                has upcoming showings
//
// Past-ness is computed on the fly from `lastShowDate` so the move happens
// the day after a run's last showtime. When the screening data has rotated
// out the month entirely, `entry` is null and we fall back to the mark's
// month key: anything whose YYYY-MM is strictly before the current month is
// considered past.
function categorizeRepMark(id, mark, entry, today) {
  if (mark.watched) return "watched";

  const last = entry ? lastShowDate(entry) : null;
  const monthKey = id.split("|")[1] || "";
  const todayMonth = today.slice(0, 7);
  const isPast = last
    ? last < today
    : (monthKey && monthKey < todayMonth);

  if (mark.interest === "no") return isPast ? "already_shown" : "not";

  // Treat a lone booking as "interested" — you wouldn't book something you
  // weren't interested in.
  if (mark.interest !== "yes" && !mark.booked) return null;

  return isPast ? "already_shown" : "interested";
}

function renderRepInterestCard(id, mark, entry) {
  const title = entry?.title || mark.meta?.title || "Unknown";
  const year = entry?.year ?? mark.meta?.year ?? null;
  const theaters = entry
    ? [...entry.theaters]
    : [mark.booked?.theater, mark.watched?.theater].filter(Boolean);
  const linkUrl = entry?.showings?.find((s) => s.url)?.url
    || (theaters[0] && repertoryState.theatersBySlug.get(theaters[0])?.url)
    || wikipediaUrl(title, `${year || ""}-01-01`);

  const titleLink = el("a", {
      class: "row__titlelink",
      href: linkUrl,
      target: "_blank",
      rel: "noopener noreferrer",
    },
    title,
  );
  const titleNode = el("h3", { class: "row__title" }, titleLink);
  if (year) {
    titleNode.appendChild(el("span", { class: "row__meta", text: ` (${year})` }));
  }

  const theaterChips = theaters.map((slug) =>
    el("span", { class: "chip--theater", text: shortTheaterName(slug) })
  );

  const bookedBadge = mark.booked
    ? el("div", { class: "row__booked", text: `🎟  Booked ${fmtShowtime(mark.booked.date, mark.booked.time, mark.booked.theater)}` })
    : null;
  const watchedBadge = mark.watched
    ? el("div", { class: "row__watched", text: `✓  Watched ${fmtShowtime(mark.watched.date, mark.watched.time, mark.watched.theater)}` })
    : null;

  const actions = el("div", { class: "rep-card__actions", dataset: { id } });
  const hasShowings = !!entry?.showings?.length;
  if (mark.interest === "yes" && !mark.watched) {
    actions.appendChild(el("button", {
      type: "button",
      class: "rep-card-action",
      dataset: { action: "book" },
      hidden: hasShowings ? false : true,
    }, mark.booked ? "Change booking" : "🎟  Book"));
  }
  if (!mark.watched) {
    actions.appendChild(el("button", {
      type: "button",
      class: "rep-card-action",
      dataset: { action: "seen" },
    }, "✓  Mark seen"));
  } else {
    actions.appendChild(el("button", {
      type: "button",
      class: "rep-card-action",
      dataset: { action: "clear-seen" },
    }, "Clear seen"));
  }
  if (mark.interest === "yes") {
    actions.appendChild(el("button", {
      type: "button",
      class: "rep-card-action rep-card-action--ghost",
      dataset: { action: "skip" },
    }, "Not interested"));
  } else if (mark.interest === "no") {
    actions.appendChild(el("button", {
      type: "button",
      class: "rep-card-action rep-card-action--ghost",
      dataset: { action: "reinterest" },
    }, "Mark interested"));
  }

  return el("div", { class: "rep-card", dataset: { id } },
    el("div", { class: "row__title-line" },
      titleNode,
      ...theaterChips,
    ),
    bookedBadge,
    watchedBadge,
    actions,
  );
}

const REP_CATEGORY_ORDER = ["interested", "watched", "already_shown", "not"];
const REP_CATEGORY_LABEL = {
  interested: "Interested",
  watched: "Watched",
  already_shown: "Already shown",
  not: "Not interested",
};

function renderRereleasesInterestsTab() {
  const list = document.getElementById("interest-list");
  const empty = document.getElementById("empty-interests");
  list.innerHTML = "";

  const grouped = { interested: [], watched: [], already_shown: [], not: [] };
  for (const [id, mark] of Object.entries(repMarks)) {
    const entry = repEntryById(id);
    // Opportunistically backfill meta so we can still render the card after
    // the run's screenings have rolled off.
    if (entry && !mark.meta) {
      mark.meta = repEntryMeta(entry);
    }
    const cat = categorizeRepMark(id, mark, entry, TODAY);
    if (!cat) continue;
    grouped[cat].push({ id, mark, entry });
  }

  const total = REP_CATEGORY_ORDER.reduce((a, k) => a + grouped[k].length, 0);
  if (!total) {
    empty.textContent = "Tap ✓ on any rerelease to start tracking it.";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  if (grouped.interested.length) {
    list.appendChild(renderRereleasesExportBar());
  }

  for (const cat of REP_CATEGORY_ORDER) {
    const items = grouped[cat];
    if (!items.length) continue;

    // Sort: most recent booked first within Interested, otherwise by month.
    items.sort((a, b) => {
      const amk = (a.id.split("|")[1] || "");
      const bmk = (b.id.split("|")[1] || "");
      const cmp = amk.localeCompare(bmk);
      return cat === "already_shown" ? -cmp : cmp;
    });

    const open = cat in interestExpanded ? interestExpanded[cat] : true;
    const details = el("details", {
        class: `month interest-group interest-group--${cat}`,
        open,
        dataset: { level: cat },
      },
      el("summary", { class: "month__summary" },
        interestIconNode(cat),
        el("span", { class: "month__name", text: REP_CATEGORY_LABEL[cat] }),
        el("span", { class: "month__count", text: `${items.length}` }),
        el("span", { class: "month__chevron", "aria-hidden": "true" }),
      ),
      el("div", { class: "month__body" },
        el("div", { class: "section" },
          el("div", { class: "section__list" },
            ...items.map(({ id, mark, entry }) => renderRepInterestCard(id, mark, entry)),
          ),
        )
      )
    );

    details.addEventListener("toggle", () => {
      interestExpanded[cat] = details.open;
      saveInterestExpanded();
    });
    const summary = details.querySelector(".month__summary");
    if (summary) {
      summary.addEventListener("click", () => {
        requestAnimationFrame(() => {
          interestExpanded[cat] = details.open;
          saveInterestExpanded();
        });
      });
    }

    list.appendChild(details);
  }
}

// Toolbar shown above the Interested group in the rereleases Interests tab.
// One button: copy an image of all upcoming Interested rereleases (with
// every upcoming showtime) to the clipboard.
function renderRereleasesExportBar() {
  const btn = el("button", {
    type: "button",
    class: "rep-export__btn",
    id: "rep-export-btn",
  },
    el("span", { class: "rep-export__icon", "aria-hidden": "true" }),
    el("span", { class: "rep-export__label", text: "Export…" }),
  );
  btn.querySelector(".rep-export__icon").innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/>' +
    '</svg>';
  btn.addEventListener("click", openRepExportDialog);
  return el("div", { class: "rep-export" }, btn);
}

// Returns a best-effort director name for a movie title by scanning the
// loaded new-releases bundles. Most rereleases are old films that aren't in
// that data; null means "omit director from the export."
let _titleDirectorMap = null;
function directorForTitle(title) {
  if (_titleDirectorMap === null) {
    _titleDirectorMap = new Map();
    for (const bundle of allBundles || []) {
      for (const release of bundle.releases || []) {
        const t = (release.title || "").trim().toLowerCase();
        const d = release.director;
        if (!t || !d || d === "—") continue;
        if (!_titleDirectorMap.has(t)) _titleDirectorMap.set(t, d);
      }
    }
  }
  return _titleDirectorMap.get((title || "").trim().toLowerCase()) || null;
}

// Gather every Interested rerelease as a per-movie record, in earliest-
// showtime order. This is the candidate set the export dialog presents the
// user — the dialog tracks which ones get included and which are starred.
function gatherRepExportCandidates() {
  const out = [];
  for (const [id, mark] of Object.entries(repMarks)) {
    const entry = repEntryById(id);
    const cat = categorizeRepMark(id, mark, entry, TODAY);
    if (cat !== "interested") continue;
    const title = entry?.title || mark.meta?.title || "Untitled";
    const year = entry?.year ?? mark.meta?.year ?? null;
    const director = directorForTitle(title);
    const showings = (entry?.showings || [])
      .filter((s) => s.date >= TODAY)
      .slice()
      .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    if (!showings.length && mark.booked) {
      showings.push({
        date: mark.booked.date,
        time: mark.booked.time,
        theater: mark.booked.theater,
      });
    }
    out.push({ id, title, year, director, showings });
  }
  out.sort((a, b) => {
    const da = a.showings[0]?.date || "9999-99-99";
    const db = b.showings[0]?.date || "9999-99-99";
    return da.localeCompare(db) || a.title.localeCompare(b.title);
  });
  return out;
}

// Build the export image as a PNG Blob from a curated set of {item, starred}
// records (chosen in the export dialog). Movie-per-card layout, starred items
// get an accented background so they stand out at a glance.
async function buildRereleasesExportBlob(selection) {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch {}
  }

  const items = (selection || []).filter((s) => s.included);

  // Layout constants — kept identical between measurement and draw to avoid
  // height drift. Source width is narrow because messaging apps render
  // attachments at the bubble's pt width, so a smaller source = bigger
  // apparent type on the recipient's phone.
  const W = 540;
  const PAD_X = 24;
  const PAD_TOP = 28;
  const PAD_BOTTOM = 28;

  const HEADER_TITLE_H = 40;
  const HEADER_SUBTITLE_H = 26;
  const HEADER_RULE_GAP = 18;

  // Card geometry.
  const CARD_INSET_X = 4;            // pull cards in from the page edge a bit
  const CARD_PAD_X = 18;
  const CARD_PAD_TOP = 16;
  const CARD_PAD_BOTTOM = 16;
  const CARD_GAP = 12;
  const CARD_RADIUS = 8;

  // Per-row sizes inside a card.
  const TITLE_LINE_H = 28;            // title — up to two lines
  const TITLE_GAP = 4;
  const DIR_ROW_H = 22;
  const SHOWTIME_ROW_H = 24;
  const THEATER_ROW_H = 22;
  const SHOWING_GAP = 6;              // gap between consecutive showings

  const FOOTER_H = 24;
  const EMPTY_H = 28;

  const FAMILY = `'DM Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
  const TITLE_FONT = `700 22px ${FAMILY}`;

  const cardX = PAD_X + CARD_INSET_X;
  const cardW = W - (PAD_X + CARD_INSET_X) * 2;
  const cardTextW = cardW - CARD_PAD_X * 2;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";

  // Pre-compute per-card title wraps so we can size the canvas correctly.
  const layouts = items.map(({ item, starred }) => {
    ctx.font = TITLE_FONT;
    // Reserve room for the leading star on starred cards.
    const titleMaxW = starred ? cardTextW - 28 : cardTextW;
    const titleLines = wrapText(
      ctx,
      item.year ? `${item.title} (${item.year})` : item.title,
      titleMaxW,
      2,
    );
    return { item, starred, titleLines };
  });

  // Measure total height.
  let H = PAD_TOP + HEADER_TITLE_H + HEADER_SUBTITLE_H + HEADER_RULE_GAP;
  if (!layouts.length) {
    H += EMPTY_H;
  } else {
    for (const layout of layouts) {
      H += cardHeight(layout);
      H += CARD_GAP;
    }
    H -= CARD_GAP;
  }
  H += HEADER_RULE_GAP + FOOTER_H + PAD_BOTTOM;

  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.scale(dpr, dpr);
  ctx.textBaseline = "alphabetic";

  // Background (Linen).
  ctx.fillStyle = "#F5EFE6";
  ctx.fillRect(0, 0, W, H);

  // ---- Header ----
  let y = PAD_TOP;
  ctx.fillStyle = "#2A2520";
  ctx.font = `700 32px ${FAMILY}`;
  ctx.fillText("Rereleases", PAD_X, y + 32);
  y += HEADER_TITLE_H;

  ctx.fillStyle = "#6F665B";
  ctx.font = `500 15px ${FAMILY}`;
  const counts = layouts.length
    ? `${layouts.length} film${layouts.length === 1 ? "" : "s"} · ${fmtDateShort(TODAY)}`
    : `No selections · ${fmtDateShort(TODAY)}`;
  ctx.fillText(counts, PAD_X, y + 16);
  y += HEADER_SUBTITLE_H;

  // Thin tan rule under the header.
  y += HEADER_RULE_GAP / 2;
  ctx.fillStyle = "rgba(184,137,90,0.32)";
  ctx.fillRect(PAD_X, y, W - PAD_X * 2, 1);
  y += HEADER_RULE_GAP / 2;

  if (!layouts.length) {
    ctx.fillStyle = "#6F665B";
    ctx.font = `400 16px ${FAMILY}`;
    ctx.fillText("Nothing selected.", PAD_X, y + 20);
  }

  // ---- Cards ----
  for (const layout of layouts) {
    const cardH = cardHeight(layout);
    drawCard(ctx, layout, cardX, y, cardW, cardH);
    y += cardH + CARD_GAP;
  }
  if (layouts.length) y -= CARD_GAP;

  // ---- Footer ----
  ctx.fillStyle = "rgba(184,137,90,0.32)";
  ctx.fillRect(PAD_X, H - PAD_BOTTOM - FOOTER_H + 8, W - PAD_X * 2, 1);
  ctx.fillStyle = "#877E72";
  ctx.font = `500 12px ${FAMILY}`;
  ctx.fillText("Upcoming Movies", PAD_X, H - PAD_BOTTOM + 12);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

  // ---- helpers (close over the layout constants) ----
  function cardHeight(layout) {
    const item = layout.item;
    const titleH = layout.titleLines.length * TITLE_LINE_H + TITLE_GAP;
    const dirH = item.director ? DIR_ROW_H : 0;
    const showings = item.showings.length ? item.showings : [null];
    const showsH = showings.reduce(
      (acc, sh, i) => acc + SHOWTIME_ROW_H + (sh?.theater ? THEATER_ROW_H : 0) + (i < showings.length - 1 ? SHOWING_GAP : 0),
      0,
    );
    return CARD_PAD_TOP + titleH + dirH + 6 + showsH + CARD_PAD_BOTTOM;
  }

  function drawCard(ctx, layout, x, y, w, h) {
    const { item, starred, titleLines } = layout;
    const bg = starred ? "rgba(184,137,90,0.14)" : "#FFFCF7";
    const border = starred ? "rgba(184,137,90,0.36)" : "rgba(60,40,20,0.10)";

    roundRectPath(ctx, x, y, w, h, CARD_RADIUS);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = border;
    ctx.stroke();

    const tx = x + CARD_PAD_X;
    let ty = y + CARD_PAD_TOP;

    // Title (with leading star on must-sees).
    ctx.font = TITLE_FONT;
    let titleX = tx;
    if (starred) {
      ctx.fillStyle = "#9C7148";
      ctx.fillText("★", tx, ty + 22);
      titleX = tx + 28;
    }
    ctx.fillStyle = "#2A2520";
    for (const line of titleLines) {
      ctx.fillText(line, titleX, ty + 22);
      ty += TITLE_LINE_H;
    }
    ty += TITLE_GAP;

    if (item.director) {
      ctx.fillStyle = "#6F665B";
      ctx.font = `500 14px ${FAMILY}`;
      drawTruncatedText(ctx, `Dir. ${item.director}`, tx, ty + 14, cardTextW);
      ty += DIR_ROW_H;
    }

    ty += 6;

    const showings = item.showings.length ? item.showings : [null];
    showings.forEach((sh, i) => {
      if (!sh) {
        ctx.fillStyle = "#877E72";
        ctx.font = `500 16px ${FAMILY}`;
        ctx.fillText("No upcoming showtimes", tx, ty + 18);
        ty += SHOWTIME_ROW_H;
        return;
      }
      ctx.fillStyle = "#2A2520";
      ctx.font = `600 17px ${FAMILY}`;
      const dateTimeText = `${fmtDateShort(sh.date)} · ${fmtTime(sh.time)}`;
      drawTruncatedText(ctx, dateTimeText, tx, ty + 18, cardTextW);
      ty += SHOWTIME_ROW_H;

      if (sh.theater) {
        ctx.fillStyle = "#6F665B";
        ctx.font = `500 14px ${FAMILY}`;
        drawTruncatedText(ctx, shortTheaterName(sh.theater), tx, ty + 14, cardTextW);
        ty += THEATER_ROW_H;
      }
      if (i < showings.length - 1) ty += SHOWING_GAP;
    });
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Greedy word wrap to up to `maxLines` lines. Last line is truncated with
// "…" if it still wouldn't fit.
function wrapText(ctx, text, maxWidth, maxLines) {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = "";
  for (const w of words) {
    const trial = current ? current + " " + w : w;
    if (ctx.measureText(trial).width <= maxWidth) {
      current = trial;
    } else {
      if (current) lines.push(current);
      current = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  // If we broke early, the tail of `text` is unrepresented — append an
  // ellipsis to the last line, trimming chars until it fits.
  const consumed = lines.join(" ");
  if (consumed.length < text.length && lines.length) {
    const ellipsis = "…";
    while (
      lines[lines.length - 1].length > 0 &&
      ctx.measureText(lines[lines.length - 1] + ellipsis).width > maxWidth
    ) {
      lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1).trimEnd();
    }
    lines[lines.length - 1] = lines[lines.length - 1] + ellipsis;
  }
  return lines;
}

function drawTruncatedText(ctx, text, x, y, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y);
    return;
  }
  const ellipsis = "…";
  const ellW = ctx.measureText(ellipsis).width;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid)).width + ellW <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  ctx.fillText(text.slice(0, lo) + ellipsis, x, y);
}

// Per-dialog-open ephemeral state. Each row tracks whether it's included
// (default true) and whether it's starred as a must-see (default false).
const repExportState = new Map();

function openRepExportDialog() {
  const dialog = document.getElementById("rep-export-dialog");
  if (!dialog) return;
  const candidates = gatherRepExportCandidates();
  repExportState.clear();
  for (const item of candidates) {
    const mark = repMarks[item.id];
    repExportState.set(item.id, {
      item,
      included: !(mark?.excluded === true),
      starred: mark?.starred === true,
    });
  }
  renderRepExportDialogList();
  // Make sure the dialog can be re-opened cleanly if it was closed without
  // the close() animation completing.
  if (dialog.open) dialog.close();
  dialog.showModal();
}

function renderRepExportDialogList() {
  const list = document.getElementById("rep-export-list");
  if (!list) return;
  list.innerHTML = "";

  if (!repExportState.size) {
    list.appendChild(el("p", {
      class: "rep-export-empty",
      text: "No interested rereleases with upcoming showings.",
    }));
    document.getElementById("rep-export-share")?.setAttribute("disabled", "");
    return;
  }
  document.getElementById("rep-export-share")?.removeAttribute("disabled");

  for (const [id, entry] of repExportState) {
    const { item, included, starred } = entry;
    const titleText = item.year ? `${item.title} (${item.year})` : item.title;
    const showtimeText = item.showings
      .slice(0, 3)
      .map((s) => `${fmtDateShort(s.date)} · ${fmtTime(s.time)} · ${shortTheaterName(s.theater)}`)
      .join(" · ");
    const moreText = item.showings.length > 3 ? ` · +${item.showings.length - 3} more` : "";

    const includeBtn = el("button", {
      type: "button",
      class: `rep-export-include${included ? " is-on" : ""}`,
      "aria-pressed": included ? "true" : "false",
      "aria-label": included ? "Remove from export" : "Add to export",
      dataset: { id, action: "toggle-include" },
    });
    includeBtn.innerHTML = included
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>';

    const starBtn = el("button", {
      type: "button",
      class: `rep-export-star${starred ? " is-on" : ""}`,
      "aria-pressed": starred ? "true" : "false",
      "aria-label": starred ? "Unstar" : "Mark as must-see",
      dataset: { id, action: "toggle-star" },
    });
    starBtn.textContent = starred ? "★" : "☆";

    const sub = el("div", { class: "rep-export-row__sub" });
    if (item.director) {
      sub.appendChild(el("span", { class: "rep-export-row__dir", text: `Dir. ${item.director}` }));
    }
    if (showtimeText) {
      sub.appendChild(el("span", { class: "rep-export-row__times", text: showtimeText + moreText }));
    }

    const body = el("div", { class: "rep-export-row__body" },
      el("div", { class: "rep-export-row__title", text: titleText }),
      sub,
    );

    const row = el("div", {
      class: `rep-export-row${included ? "" : " is-excluded"}`,
      dataset: { id },
    },
      includeBtn,
      body,
      starBtn,
    );
    list.appendChild(row);
  }
}

document.getElementById("rep-export-list")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  e.preventDefault();
  const id = btn.dataset.id;
  const entry = repExportState.get(id);
  if (!entry) return;
  if (btn.dataset.action === "toggle-include") entry.included = !entry.included;
  else if (btn.dataset.action === "toggle-star") {
    entry.starred = !entry.starred;
    // Starring auto-includes — otherwise the toggle is meaningless.
    if (entry.starred) entry.included = true;
  }
  setRepExportFlags(id, { starred: entry.starred, excluded: !entry.included });
  renderRepExportDialogList();
});

document.getElementById("rep-export-cancel")?.addEventListener("click", () => {
  document.getElementById("rep-export-dialog")?.close();
});

document.getElementById("rep-export-share")?.addEventListener("click", async () => {
  const shareBtn = document.getElementById("rep-export-share");
  if (!shareBtn || shareBtn.hasAttribute("disabled")) return;
  shareBtn.setAttribute("disabled", "");
  const originalLabel = shareBtn.textContent;
  shareBtn.textContent = "Rendering…";

  const selection = [...repExportState.values()].map(({ item, included, starred }) => ({
    item, included, starred,
  }));

  const restore = (text, closeDialog) => {
    shareBtn.textContent = text;
    setTimeout(() => {
      if (closeDialog) document.getElementById("rep-export-dialog")?.close();
      shareBtn.textContent = originalLabel;
      shareBtn.removeAttribute("disabled");
    }, closeDialog ? 700 : 1500);
  };

  try {
    const blob = await buildRereleasesExportBlob(selection);
    if (!blob) { restore("Nothing to share"); return; }
    const file = new File([blob], "rereleases.png", { type: "image/png" });

    // Preferred path: iOS share sheet. "Copy" lives inside it, so the user's
    // old copy-image flow is still one tap away.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Rereleases" });
        restore("Shared ✓", true);
        return;
      } catch (e) {
        // User canceled the share sheet — treat as a no-op, not an error.
        if (e?.name === "AbortError") { restore(originalLabel); return; }
        throw e;
      }
    }

    // Fallback 1: clipboard image.
    if (typeof ClipboardItem !== "undefined" &&
        navigator.clipboard?.write) {
      const item = new ClipboardItem({ "image/png": blob });
      await navigator.clipboard.write([item]);
      restore("Copied ✓", true);
      return;
    }

    // Fallback 2: download.
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rereleases.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    restore("Downloaded");
  } catch (e) {
    console.warn("Rerelease export failed:", e);
    restore("Couldn't share");
  }
});

// Handle clicks on rep-card action buttons in the Interests tab.
async function handleRepCardAction(id, action) {
  const mark = getRepMark(id);
  if (!mark) return;
  const entry = findRepEntryById(id);
  const meta = entry ? repEntryMeta(entry) : mark.meta;

  if (action === "skip") {
    setRepInterest(id, "no", meta);
  } else if (action === "reinterest") {
    setRepInterest(id, "yes", meta);
  } else if (action === "clear-seen") {
    setRepWatched(id, null);
  } else if (action === "book" || action === "seen") {
    const isBook = action === "book";
    const existing = isBook ? mark.booked : mark.watched;
    const selectedKey = existing
      ? `${existing.date}|${existing.time}|${existing.theater}`
      : null;
    const showings = entry?.showings || [];
    if (!showings.length && !existing) {
      // Nothing to pick and nothing to remove.
      return;
    }
    const result = await requestShowtimeDialog({
      heading: isBook ? "Book showtime" : "Mark seen",
      copy: isBook
        ? "Pick which showtime you're going to."
        : "Pick the showtime you caught.",
      showings,
      isUpdate: !!existing,
      selectedKey,
    });
    if (result.action === "cancel") return;
    if (result.action === "remove") {
      if (isBook) setRepBooked(id, null);
      else setRepWatched(id, null);
    } else if (result.action === "save") {
      const chosen = {
        date: result.showing.date,
        time: result.showing.time,
        theater: result.showing.theater,
      };
      if (isBook) setRepBooked(id, chosen, meta);
      else setRepWatched(id, chosen, meta);
    }
  }
  renderInterestsTab(allBundles);
  if (activeTab === "list" && activeKind === "rereleases") renderRepertoryTab();
  else tabDirty.list = true;
  if (activeTab === "calendar") renderCalendarTab(allBundles);
  else tabDirty.calendar = true;
}

// ---------- Activity tab rendering ----------

const ACTIVITY_FIELD_LABEL = {
  date: "Release date",
  release_type: "Release type",
  studio: "Studio",
  director: "Director",
};

const ACTIVITY_CHIP = {
  added: { text: "New", className: "activity-chip activity-chip--added" },
  removed: { text: "Removed", className: "activity-chip activity-chip--removed" },
  date: { text: "Date", className: "activity-chip activity-chip--date" },
  release_type: { text: "Type", className: "activity-chip activity-chip--type" },
  studio: { text: "Studio", className: "activity-chip activity-chip--studio" },
  director: { text: "Director", className: "activity-chip activity-chip--director" },
};

function activityChipFor(ev) {
  if (ev.type === "added") return ACTIVITY_CHIP.added;
  if (ev.type === "removed") return ACTIVITY_CHIP.removed;
  return ACTIVITY_CHIP[ev.field] || ACTIVITY_CHIP.date;
}

function fmtActivityValue(field, v) {
  if (v == null || v === "") return "—";
  if (field === "date") return fmtDateShort(v);
  if (field === "release_type") return chipLabel(v);
  return String(v);
}

function fmtActivityDay(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date(TODAY + "T12:00:00");
  const dayKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (dayKey === TODAY) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const ykey = `${yesterday.getFullYear()}-${pad2(yesterday.getMonth() + 1)}-${pad2(yesterday.getDate())}`;
  if (dayKey === ykey) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric" });
}

function describeEvent(ev) {
  if (ev.type === "added") {
    const bits = [];
    if (ev.date) bits.push(fmtDateShort(ev.date));
    if (ev.release_type) bits.push(chipLabel(ev.release_type));
    return bits.length ? `Added · ${bits.join(" · ")}` : "Added";
  }
  if (ev.type === "removed") {
    return ev.date ? `Removed (was ${fmtDateShort(ev.date)})` : "Removed";
  }
  const label = ACTIVITY_FIELD_LABEL[ev.field] || ev.field;
  const from = fmtActivityValue(ev.field, ev.from);
  const to = fmtActivityValue(ev.field, ev.to);
  return `${label}: ${from} → ${to}`;
}

function renderActivityRow(ev) {
  const chip = activityChipFor(ev);
  const titleLink = el("a", {
      class: "row__titlelink",
      href: wikipediaUrl(ev.title, ev.date || ""),
      target: "_blank",
      rel: "noopener noreferrer",
    },
    ev.title,
  );

  return el("div", { class: `row activity-row activity-row--${ev.type}${ev.field ? ` activity-row--${ev.field}` : ""}` },
    el("div", { class: "row__title-line" },
      el("h3", { class: "row__title" }, titleLink),
      el("span", { class: chip.className, text: chip.text }),
    ),
    el("div", { class: "activity-row__desc", text: describeEvent(ev) }),
  );
}

function groupActivityByDay(events) {
  const map = new Map();
  for (const ev of events) {
    const d = new Date(ev.at);
    const dayKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    if (!map.has(dayKey)) map.set(dayKey, []);
    map.get(dayKey).push(ev);
  }
  return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
}

function updateActivityBadge() {
  const badge = document.getElementById("activity-badge");
  if (!badge) return;
  const n = Activity.unreadCount();
  if (n > 0) {
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function renderActivityTab() {
  const list = document.getElementById("activity-list");
  const empty = document.getElementById("empty-activity");
  if (!list || !empty) return;
  list.innerHTML = "";

  const wantKind = activeKind === "rereleases" ? "screening" : "release";
  const events = Activity.readLog().filter(
    (ev) => (ev.kind || "release") === wantKind,
  );
  if (!events.length) {
    empty.textContent = activeKind === "rereleases"
      ? "No rerelease changes yet."
      : "No changes yet. We'll track new movies and release updates here.";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const seen = Activity.getLastSeen();
  const groups = groupActivityByDay(events);
  for (const [, items] of groups) {
    const firstAt = items[0].at;
    const header = el("div", { class: "section__header" },
      el("span", { class: "section__date", text: fmtActivityDay(firstAt) }),
      el("span", { class: "section__count", text: `${items.length}` }),
    );
    const rows = items.map((ev) => {
      const row = renderActivityRow(ev);
      if (seen && ev.at > seen) row.classList.add("activity-row--new");
      else if (!seen) row.classList.add("activity-row--new");
      return row;
    });
    const body = el("div", { class: "section__list" }, ...rows);
    list.appendChild(el("section", { class: "section" }, header, body));
  }
}

// ---------- Year tab rendering ----------

function renderYearTab(bundles) {
  bundles = bundles.filter((b) => b.releases && b.releases.length);
  bundles = sortMonthOrder(bundles);

  const list = document.getElementById("list");
  list.innerHTML = "";

  const rendered = [];
  for (const b of bundles) {
    const node = renderMonth(b);
    if (node) rendered.push(node);
  }

  const empty = document.getElementById("empty-year");
  if (!rendered.length) {
    empty.textContent = searchQuery
      ? "No releases match your search."
      : "No releases match current filters.";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const node of rendered) list.appendChild(node);
}

// ---------- Calendar tab rendering ----------

const calState = {
  year: YEAR,
  monthIdx: now.getMonth(),
  selected: TODAY,
};

// Build the calendar date → items map for the current global `activeKind`.
// Each entry is either a release object or a screening object (tagged with
// `_kind: "screening"`); downstream renderers branch on the tag.
function itemsByDate(bundles) {
  const map = new Map();
  if (activeKind === "releases") {
    for (const b of bundles) {
      for (const m of b.releases) {
        if (!matchesScope(m)) continue;
        if (!matchesAmcLocal(m)) continue;
        if (!matchesNotSkipped(m)) continue;
        if (!map.has(m.date)) map.set(m.date, []);
        map.get(m.date).push(m);
      }
    }
  } else {
    for (const s of repertoryState.data?.screenings || []) {
      // Show every re-release screening on the calendar. (Previously limited
      // to runs marked "Interested," which hid most of the data.) Still honor
      // the Hide-skipped toggle by dropping runs explicitly marked "not."
      if (hideSkipped && getRepInterest(repTitleMonthId(s)) === "no") continue;
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date).push({ ...s, _kind: "screening" });
    }
  }
  return map;
}

function movieIndex(bundles) {
  const map = new Map();
  for (const b of bundles) {
    for (const m of b.releases) map.set(movieKey(m), m);
  }
  for (const s of repertoryState.data?.screenings || []) {
    map.set(screeningKey(s), { ...s, _kind: "screening" });
  }
  return map;
}

function placeholderMovie(mark) {
  if (mark?.kind === "screening") {
    return {
      _kind: "screening",
      theater: mark.theater || "unknown",
      title: mark.title || "Unknown",
      year: null,
      date: mark.date || "",
      time: mark.time || "",
      format: mark.format || null,
      series: mark.series || null,
      url: mark.url || null,
    };
  }
  return {
    title: mark?.title || "Unknown",
    date: mark?.date || "",
    director: "—",
    studio: "—",
    budget_usd: null,
    release_type: "wide",
    genre: "",
    cast: "—",
    tmdb_id: mark?.tmdb_id || null,
  };
}

function marksByField(level, field) {
  const map = new Map();
  for (const [key, mark] of Object.entries(Interests.allMarks())) {
    if (mark?.level !== level) continue;
    const d = mark[field];
    if (!d) continue;
    if (!map.has(d)) map.set(d, []);
    map.get(d).push({ key, mark });
  }
  return map;
}

// Drop booked/watched entries that don't belong to the calendar's current
// `activeKind`, so the Calendar stays strictly one-kind-at-a-time: New
// Releases hides re-release screenings, Rereleases hides new-release rows.
// Screening keys are `rep:…`; release keys are `tmdb:…` / `ttl:…`.
function marksForActiveKind(map) {
  const wantScreening = activeKind === "rereleases";
  const out = new Map();
  for (const [date, entries] of map) {
    const kept = entries.filter(
      ({ key }) => key.startsWith("rep:") === wantScreening
    );
    if (kept.length) out.set(date, kept);
  }
  return out;
}

function topLevelForDate(items) {
  const priority = { watched: 0, booked: 1, must: 2, likely: 3, potential: 4, not: 5 };
  let best = null;
  let bestRank = 99;
  for (const m of items) {
    const lv = Interests.getLevel(movieKey(m));
    if (lv && priority[lv] < bestRank) {
      best = lv;
      bestRank = priority[lv];
    }
  }
  return best;
}

function renderCalendarDayList(items, selectedDate, byKey, bookedMap, watchedMap) {
  const dayBox = document.getElementById("cal-day");
  if (!dayBox) return;
  dayBox.innerHTML = "";

  const bookedEntries = bookedMap.get(selectedDate) || [];
  const watchedEntries = watchedMap.get(selectedDate) || [];

  const resolve = ({ key, mark }) => byKey.get(key) || placeholderMovie(mark);
  const bookedMovies = bookedEntries.map(resolve);
  const watchedMovies = watchedEntries.map(resolve);

  if (!items.length && !bookedMovies.length && !watchedMovies.length) {
    dayBox.appendChild(
      el("p", { class: "calendar__empty", text: "Nothing on this day." })
    );
    return;
  }

  const renderAny = (m) =>
    m._kind === "screening"
      ? renderScreening(m, { showDate: true })
      : renderRow(m, { showDate: true });

  const addSection = (label, count, rows) => {
    if (!rows.length) return;
    const header = el("div", { class: "section__header" },
      el("span", { class: "section__date", text: label }),
      el("span", { class: "section__count", text: `${count}` }),
    );
    const list = el("div", { class: "section__list" }, ...rows.map(renderAny));
    dayBox.appendChild(el("div", { class: "section" }, header, list));
  };

  addSection("Booked", bookedMovies.length, bookedMovies);
  addSection("Watched", watchedMovies.length, watchedMovies);

  if (items.length) {
    const header = el("div", { class: "section__header" },
      el("span", { class: "section__date", text: fmtDateShort(items[0].date) }),
      el("span", { class: "section__count", text: `${items.length}` }),
    );
    const list = el("div", { class: "section__list" }, ...items.map(renderAny));
    dayBox.appendChild(el("div", { class: "section" }, header, list));
  }
}

function renderCalendarTab(bundles) {
  const grid = document.getElementById("cal-grid");
  const label = document.getElementById("cal-month");
  if (!grid || !label) return;
  grid.innerHTML = "";

  const { year, monthIdx } = calState;
  label.textContent = monthLabel(year, monthIdx);

  const firstDow = new Date(year, monthIdx, 1).getDay();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const prevMonthDays = new Date(year, monthIdx, 0).getDate();
  const byDate = itemsByDate(bundles);
  const byKey = movieIndex(bundles);
  const bookedMap = marksForActiveKind(marksByField("booked", "booked_date"));
  const watchedMap = marksForActiveKind(marksByField("watched", "watched_date"));

  const cellCount = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  for (let i = 0; i < cellCount; i++) {
    const dayNum = i - firstDow + 1;
    const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
    let cellYear = year, cellMonth = monthIdx, cellDay = dayNum;
    if (dayNum < 1) {
      cellMonth = monthIdx - 1;
      cellDay = prevMonthDays + dayNum;
      if (cellMonth < 0) { cellMonth = 11; cellYear = year - 1; }
    } else if (dayNum > daysInMonth) {
      cellMonth = monthIdx + 1;
      cellDay = dayNum - daysInMonth;
      if (cellMonth > 11) { cellMonth = 0; cellYear = year + 1; }
    }
    const iso = dateKey(cellYear, cellMonth, cellDay);
    const items = byDate.get(iso) || [];
    const isToday = iso === TODAY;
    const isSelected = iso === calState.selected;
    const topLv = topLevelForDate(items);
    const hasBooked = bookedMap.has(iso);
    const hasWatched = watchedMap.has(iso);

    const cls = [
      "calendar__cell",
      inMonth ? "" : "calendar__cell--out",
      isToday ? "calendar__cell--today" : "",
      isSelected ? "calendar__cell--selected" : "",
      items.length ? "calendar__cell--has" : "",
      topLv ? `calendar__cell--${topLv}` : "",
      hasBooked ? "calendar__cell--has-booked" : "",
      hasWatched ? "calendar__cell--has-watched" : "",
    ].filter(Boolean).join(" ");

    const dots = (hasBooked || hasWatched)
      ? el("span", { class: "calendar__dots", "aria-hidden": "true" },
          hasBooked ? el("span", { class: "calendar__dot calendar__dot--booked" }) : null,
          hasWatched ? el("span", { class: "calendar__dot calendar__dot--watched" }) : null,
        )
      : null;

    const cell = el("button", {
        type: "button",
        class: cls,
        role: "gridcell",
        "aria-label": fmtDateShort(iso),
        dataset: { date: iso, inMonth: String(inMonth) },
      },
      el("span", { class: "calendar__daynum", text: String(cellDay) }),
      items.length
        ? el("span", { class: "calendar__count", text: String(items.length) })
        : null,
      dots,
    );
    grid.appendChild(cell);
  }

  const selectedItems = (byDate.get(calState.selected) || [])
    .slice()
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  renderCalendarDayList(selectedItems, calState.selected, byKey, bookedMap, watchedMap);
}

function shiftCalendar(delta) {
  let m = calState.monthIdx + delta;
  let y = calState.year;
  while (m < 0) { m += 12; y -= 1; }
  while (m > 11) { m -= 12; y += 1; }
  calState.year = y;
  calState.monthIdx = m;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const selDay = Math.min(parseInt(calState.selected.slice(8, 10), 10), daysInMonth);
  calState.selected = dateKey(y, m, selDay);
  renderCalendarTab(allBundles);
}

// ---------- Repertory tab rendering ----------

const THEATER_FILTER_KEY = "upcoming:theater-filters";

// Theater chip groups. When ≥2 group members have screenings in the current
// window we collapse them into a single chip — toggling it bulk-hides or
// bulk-shows every member at once. Currently only "AMC" qualifies (the six
// directly-scraped AMC venues plus the Fathom-discovered AMCs / Universal
// Cinema AMC at CityWalk).
const THEATER_GROUPS = [
  {
    slug: "amc",
    name: "AMC",
    matches: (t) => /\bAMC\b/i.test(t?.name || ""),
  },
];

const repertoryState = {
  data: null,                         // { theaters, screenings, ... } or null
  theatersBySlug: new Map(),
  // Cached groupings — built lazily, invalidated when the underlying screening
  // list changes (data swap or theater-filter toggle).
  _groupedAll: null,                  // groupByTitleMonth(all screenings)
  _groupedActive: null,               // groupByTitleMonth(activeScreenings())
  _entryById: null,                   // id -> entry, built from _groupedAll
  hiddenTheaters: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(THEATER_FILTER_KEY) || "null");
      if (saved && typeof saved === "object") return new Set(saved);
    } catch {}
    return new Set();
  })(),
};

function invalidateRepertoryCaches() {
  repertoryState._groupedAll = null;
  repertoryState._groupedActive = null;
  repertoryState._entryById = null;
}

function groupedAllRep() {
  if (!repertoryState._groupedAll) {
    repertoryState._groupedAll = groupByTitleMonth(
      repertoryState.data?.screenings || []
    );
  }
  return repertoryState._groupedAll;
}

function groupedActiveRep() {
  if (!repertoryState._groupedActive) {
    repertoryState._groupedActive = groupByTitleMonth(activeScreenings());
  }
  return repertoryState._groupedActive;
}

function repEntryById(id) {
  if (!repertoryState._entryById) {
    const map = new Map();
    for (const [, titleMap] of groupedAllRep()) {
      for (const [eid, entry] of titleMap) map.set(eid, entry);
    }
    repertoryState._entryById = map;
  }
  return repertoryState._entryById.get(id) || null;
}

function saveTheaterFilters() {
  try {
    localStorage.setItem(
      THEATER_FILTER_KEY,
      JSON.stringify([...repertoryState.hiddenTheaters])
    );
  } catch {}
}

function setRepertoryData(data) {
  repertoryState.data = data;
  repertoryState.theatersBySlug = new Map(
    (data?.theaters || []).map((t) => [t.slug, t])
  );
  amcLocalTitles.clear();
  for (const t of data?.amc_local_titles || []) amcLocalTitles.add(t);
  invalidateRepertoryCaches();
}

function activeScreenings() {
  const all = repertoryState.data?.screenings || [];
  const hidden = repertoryState.hiddenTheaters;
  return all.filter((s) => !hidden.has(s.theater));
}

function renderTheaterFilterBar() {
  const bar = document.getElementById("theater-filter-bar");
  if (!bar) return;
  bar.innerHTML = "";
  const data = repertoryState.data;
  if (!data?.theaters?.length) return;

  // Only show theaters that actually have screenings in the current window.
  const hasScreenings = new Set(
    (data.screenings || []).map((s) => s.theater)
  );
  const theaters = data.theaters.filter((t) => hasScreenings.has(t.slug));
  if (!theaters.length) return;

  // Pull out group members first so they don't double-render as solo chips.
  const grouped = new Set();
  const groupChips = [];
  for (const g of THEATER_GROUPS) {
    const members = theaters.filter((t) => g.matches(t));
    if (members.length < 2) continue;
    for (const m of members) grouped.add(m.slug);
    const slugs = members.map((m) => m.slug);
    const allActive = slugs.every((s) => !repertoryState.hiddenTheaters.has(s));
    groupChips.push(
      el("button", {
          type: "button",
          class: `theater-chip${allActive ? " is-active" : ""}`,
          dataset: { slugs: slugs.join(",") },
        },
        g.name,
      ),
    );
  }
  // Whitespace text nodes between chips let `text-align: justify` distribute
  // the slack across the row instead of pooling it on the right.
  const appendChip = (chip) => {
    if (bar.lastChild) bar.appendChild(document.createTextNode(" "));
    bar.appendChild(chip);
  };
  for (const chip of groupChips) appendChip(chip);

  for (const t of theaters) {
    if (grouped.has(t.slug)) continue;
    const active = !repertoryState.hiddenTheaters.has(t.slug);
    const btn = el("button", {
        type: "button",
        class: `theater-chip${active ? " is-active" : ""}`,
        dataset: { slug: t.slug },
      },
      t.name.replace(/^AMC /, "").replace(/^The /, ""),
    );
    appendChip(btn);
  }

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".theater-chip");
    if (!btn) return;
    const slugs = btn.dataset.slugs
      ? btn.dataset.slugs.split(",").filter(Boolean)
      : btn.dataset.slug ? [btn.dataset.slug] : [];
    if (!slugs.length) return;
    // Group chip behaves as one unit: if any member is currently shown,
    // hide the whole group; otherwise reveal them all.
    const anyVisible = slugs.some((s) => !repertoryState.hiddenTheaters.has(s));
    if (anyVisible) {
      for (const s of slugs) repertoryState.hiddenTheaters.add(s);
    } else {
      for (const s of slugs) repertoryState.hiddenTheaters.delete(s);
    }
    saveTheaterFilters();
    repertoryState._groupedActive = null;
    renderTheaterFilterBar();
    renderRepertoryTab();
  }, { once: true });
}

// Collapse a flat screening list into { monthKey -> { titleMonthId -> entry } }.
// Each entry represents one film's run across any and all theaters in one
// calendar month, carrying every showtime. If three AMCs and the Nuart all
// show the same title in April, they collapse into one entry with four
// theaters and all showings merged.
function groupByTitleMonth(screenings) {
  const months = new Map();
  for (const s of screenings) {
    const monthKey = (s.date || "").slice(0, 7);
    if (!monthKey) continue;
    const id = repTitleMonthId(s);
    let monthGroup = months.get(monthKey);
    if (!monthGroup) months.set(monthKey, (monthGroup = new Map()));
    let entry = monthGroup.get(id);
    if (!entry) {
      entry = {
        id,
        title: s.title,
        year: s.year || null,
        // Format / series are usually consistent across showtimes but can
        // vary (e.g. one midnight show in a run). Carry the first non-null.
        format: s.format || null,
        series: s.series || null,
        theaters: new Set(),
        showings: [],
      };
      monthGroup.set(id, entry);
    }
    if (!entry.format && s.format) entry.format = s.format;
    if (!entry.series && s.series) entry.series = s.series;
    if (s.theater) entry.theaters.add(s.theater);
    entry.showings.push(s);
  }
  for (const monthGroup of months.values()) {
    for (const entry of monthGroup.values()) {
      entry.showings.sort(
        (a, b) =>
          (a.date || "").localeCompare(b.date || "") ||
          (a.time || "").localeCompare(b.time || "")
      );
    }
  }
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b));
}

// Helpers for rendering and category logic.
function repEntryMeta(entry) {
  return {
    title: entry.title,
    year: entry.year,
    format: entry.format,
    series: entry.series,
  };
}

function lastShowDate(entry) {
  const s = entry?.showings?.[entry.showings.length - 1];
  return s?.date || null;
}

function theaterName(slug) {
  const meta = repertoryState.theatersBySlug.get(slug);
  return meta?.name || slug || "Unknown theater";
}

function shortTheaterName(slug) {
  return theaterName(slug).replace(/^AMC /, "").replace(/^The /, "");
}

function fmtShowtime(date, time, theater) {
  const when = `${fmtDateShort(date)} · ${fmtTime(time)}`;
  return theater ? `${when} · ${shortTheaterName(theater)}` : when;
}

// Look up the current screening entry for a given rep mark id. Used to gather
// showtime lists for the picker and to backfill meta when marks are edited.
// Returns null if the id's run isn't in the current screening window.
function findRepEntryById(id) {
  return repEntryById(id);
}

const fmtMonthLabel = (yyyymm) => {
  const [y, m] = yyyymm.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yyyymm;
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

function renderRepTitleRow(entry) {
  const theaters = [...entry.theaters];
  const firstTheaterMeta = theaters.length ? repertoryState.theatersBySlug.get(theaters[0]) : null;
  const linkUrl = entry.showings.find((s) => s.url)?.url
    || firstTheaterMeta?.url
    || wikipediaUrl(entry.title, `${entry.year || ""}-01-01`);

  const titleLink = el("a", {
      class: "row__titlelink",
      href: linkUrl,
      target: "_blank",
      rel: "noopener noreferrer",
    },
    entry.title || "Untitled",
  );
  const titleNode = el("h3", { class: "row__title" }, titleLink);
  if (entry.format) {
    titleNode.appendChild(el("span", { class: "chip--format", text: entry.format }));
  }
  if (entry.year) {
    titleNode.appendChild(el("span", { class: "row__meta", text: ` (${entry.year})` }));
  }

  const theaterChips = theaters.map((slug) =>
    el("span", { class: "chip--theater", text: shortTheaterName(slug) })
  );

  const countText = `${entry.showings.length} showing${entry.showings.length === 1 ? "" : "s"}`;

  const interest = getRepInterest(entry.id);
  const booked = getRepBooked(entry.id);
  const watched = getRepWatched(entry.id);

  const mkMarkBtn = (value, icon, label) => el("button", {
      type: "button",
      class: `rep-interest rep-interest--${value}${interest === value ? " is-on" : ""}`,
      "aria-pressed": interest === value ? "true" : "false",
      "aria-label": label,
      title: label,
      dataset: { id: entry.id, mark: value },
    },
    icon,
  );
  const markButtons = el("div", { class: "rep-interest-group" },
    mkMarkBtn("yes", "✓", "Interested"),
    mkMarkBtn("no", "✕", "Not interested"),
  );

  const bookedBadge = booked
    ? el("div", { class: "row__booked", text: `🎟  Booked ${fmtShowtime(booked.date, booked.time, booked.theater)}` })
    : null;
  const watchedBadge = watched
    ? el("div", { class: "row__watched", text: `✓  Watched ${fmtShowtime(watched.date, watched.time, watched.theater)}` })
    : null;

  const summary = el("summary", { class: "rep-title__summary" },
    el("div", { class: "rep-title__head" },
      el("div", { class: "row__title-line" },
        titleNode,
        ...theaterChips,
      ),
      markButtons,
    ),
    el("div", { class: "rep-title__meta" },
      el("span", { class: "row__meta", text: countText }),
      entry.series ? el("span", { class: "row__meta", text: ` · ${entry.series}` }) : null,
    ),
    bookedBadge,
    watchedBadge,
  );

  const body = el("div", { class: "rep-title__body" },
    ...entry.showings.map((s) => {
      const when = fmtShowtime(s.date, s.time, theaters.length > 1 ? s.theater : null);
      return el("div", { class: "rep-title__showing" },
        s.url
          ? el("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", text: when })
          : el("span", { text: when }),
      );
    }),
    renderRepTrailerSection(entry),
  );

  const modClass = interest === "yes" ? " rep-title--on" : interest === "no" ? " rep-title--off" : "";
  const details = el("details", {
      class: `rep-title${modClass}`,
      dataset: { id: entry.id },
    },
    summary,
    body,
  );
  return details;
}

function renderRepertoryTab() {
  const list = document.getElementById("repertory-list");
  const empty = document.getElementById("empty-repertory");
  if (!list || !empty) return;
  list.innerHTML = "";

  const data = repertoryState.data;
  const screenings = activeScreenings();
  if (!screenings.length) {
    empty.textContent = data?.screenings?.length
      ? "No screenings match the current theater filter."
      : "No repertory screenings loaded yet. The next data refresh will populate this list.";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  // Mirror the new-releases layout: collapsible month wrappers with the
  // current/next months expanded by default and past months pushed below
  // the upcoming ones. Inner per-title grouping stays intact.
  const groups = groupedActiveRep();
  const upcoming = [];
  const past = [];
  for (const g of groups) (g[0] < CURRENT_MONTH_KEY ? past : upcoming).push(g);
  const ordered = [...upcoming, ...past];

  let renderedAny = false;
  for (const [monthKey, titleMap] of ordered) {
    const entries = [...titleMap.values()]
      .filter(matchesRepEntryQuery)
      .sort(
        (a, b) =>
          (a.title || "").localeCompare(b.title || "") ||
          (a.theater || "").localeCompare(b.theater || ""),
      );
    if (!entries.length) continue;
    renderedAny = true;
    const defaultOpen = monthKey === CURRENT_MONTH_KEY || monthKey === NEXT_MONTH_KEY;
    const open = searchQuery
      ? true
      : (monthKey in expanded ? expanded[monthKey] : defaultOpen);
    const isPast = monthKey < CURRENT_MONTH_KEY;

    const details = el("details", {
        class: isPast ? "month month--past" : "month",
        open,
        dataset: { monthKey },
      },
      el("summary", { class: "month__summary" },
        el("span", { class: "month__chevron", "aria-hidden": "true" }),
        el("span", { class: "month__name", text: fmtMonthLabel(monthKey) }),
        el("span", { class: "month__count", text: `${entries.length}` }),
      ),
      el("div", { class: "month__body" },
        el("section", { class: "section" },
          el("div", { class: "section__list" }, ...entries.map(renderRepTitleRow)),
        ),
      ),
    );

    details.addEventListener("toggle", () => {
      expanded[monthKey] = details.open;
      saveExpanded();
    });
    const summary = details.querySelector(".month__summary");
    if (summary) {
      summary.addEventListener("click", () => {
        requestAnimationFrame(() => {
          expanded[monthKey] = details.open;
          saveExpanded();
        });
      });
    }

    list.appendChild(details);
  }

  if (!renderedAny) {
    empty.textContent = searchQuery
      ? "No screenings match your search."
      : "No screenings match the current theater filter.";
    empty.hidden = false;
  }
}

// Delegated trailer toggle. Mutates the trailer wrap in place (rather than
// re-rendering the row) so neighbouring rows that already have an iframe
// playing don't get torn down and restarted every tap.
function handleTrailerClick(e) {
  const btn = e.target.closest("[data-trailer-toggle]");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const key = btn.dataset.key;
  const ytId = btn.dataset.yt;
  if (!key || !ytId) return;
  // New-release rows render the button in the title line and the frame
  // wrapper at the bottom of the card, so the button is no longer inside
  // the wrap. Fall back to scoping the lookup to the enclosing card.
  const wrap = btn.closest("[data-trailer-wrap]")
    || btn.closest(".row, .rep-title")?.querySelector("[data-trailer-wrap]");
  if (!wrap) return;
  const existing = wrap.querySelector(".row__trailer-frame");
  if (existing) {
    existing.remove();
    openTrailers.delete(key);
    btn.classList.remove("is-on");
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-expanded", "false");
    const label = btn.querySelector("span");
    if (label) label.textContent = "Trailer";
  } else {
    const frame = el("div", { class: "row__trailer-frame" },
      el("iframe", {
        src: trailerEmbedUrl(ytId),
        allow: "autoplay; encrypted-media; picture-in-picture; web-share",
        allowfullscreen: "",
        loading: "lazy",
        referrerpolicy: "strict-origin-when-cross-origin",
        title: "Trailer",
      }),
    );
    wrap.appendChild(frame);
    openTrailers.add(key);
    btn.classList.add("is-on");
    btn.setAttribute("aria-pressed", "true");
    btn.setAttribute("aria-expanded", "true");
    const label = btn.querySelector("span");
    if (label) label.textContent = "Hide trailer";
  }
}

document.getElementById("list")?.addEventListener("click", handleTrailerClick);
document.getElementById("cal-day")?.addEventListener("click", handleTrailerClick);
document.getElementById("interest-list")?.addEventListener("click", handleTrailerClick);
document.getElementById("repertory-list")?.addEventListener("click", handleTrailerClick);

document.getElementById("repertory-list")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".rep-interest");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const id = btn.dataset.id;
  const want = btn.dataset.mark; // "yes" | "no"
  if (!id || !want) return;
  // Tapping the active mark clears it; tapping the other flips the state.
  const entry = findRepEntryById(id);
  const meta = entry ? repEntryMeta(entry) : null;
  setRepInterest(id, getRepInterest(id) === want ? null : want, meta);
  renderRepertoryTab();
  // Other tabs depend on rep interest state too; rebuild whichever is showing
  // and stash a dirty flag for the rest so they're rebuilt on next visit.
  if (activeTab === "calendar") renderCalendarTab(allBundles);
  else tabDirty.calendar = true;
  if (activeTab === "interests") renderInterestsTab(allBundles);
  else tabDirty.interests = true;
});

document.getElementById("interest-list")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".rep-card-action");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const actions = btn.closest(".rep-card__actions");
  const id = actions?.dataset.id;
  const action = btn.dataset.action;
  if (!id || !action) return;
  handleRepCardAction(id, action);
});

// ---------- Directors tab ----------

const CHEVRON_UP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>`;
const CHEVRON_DOWN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

// Lookup of normalized director name → matched releases. Repertory screenings
// don't carry a director field, so they're not in this index. Built once after
// loadYear settles; re-render of the Directors tab re-reads it.
const directorIndex = new Map();
// Display-name list (preserves original spelling) sorted alphabetically, used
// to power autocomplete suggestions in the Add/Edit dialog.
const directorDisplayList = [];

const normalizeDirectorName = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    // Strip punctuation that varies between sources (periods in "J.J." vs
    // "JJ", apostrophes in O'Connor, hyphens in Wong Kar-wai).
    .replace(/[.'’\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function buildDirectorIndex(bundles) {
  directorIndex.clear();
  const displayByKey = new Map();
  for (const bundle of bundles || []) {
    for (const release of bundle.releases || []) {
      const raw = release.director;
      if (!raw || raw === "—") continue;
      // Split on common separators (", ", " & ", " and ").
      const names = raw.split(/\s*(?:,|&|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
      // "Directed as lead" — only credit films with a single director.
      // Co-directed films are excluded for both directors so the inline list
      // and the autocomplete count stay consistent with the TMDB filmography.
      if (names.length !== 1) continue;
      const key = normalizeDirectorName(names[0]);
      if (!key) continue;
      if (!directorIndex.has(key)) directorIndex.set(key, []);
      directorIndex.get(key).push(release);
      if (!displayByKey.has(key)) displayByKey.set(key, names[0]);
    }
  }
  for (const list of directorIndex.values()) {
    list.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }
  directorDisplayList.length = 0;
  for (const [key, name] of displayByKey) {
    directorDisplayList.push({ key, name, count: directorIndex.get(key).length });
  }
  directorDisplayList.sort((a, b) => a.name.localeCompare(b.name));
}

function moviesForDirector(name) {
  const key = normalizeDirectorName(name);
  return key ? (directorIndex.get(key) || []) : [];
}

function renderDirectorFilm(m, opts = {}) {
  const key = movieKey(m);
  const level = Interests.getLevel(key);
  const titleLink = el("a", {
      class: "director-film__title",
      href: wikipediaUrl(m.title, m.date),
      target: "_blank",
      rel: "noopener noreferrer",
    },
    m.title,
  );
  const dateLabel = m.date ? fmtDateShort(m.date) : "";
  // When `interactive`, the level chip becomes a button that cycles interest
  // in place (used on the Studios tab); otherwise it's a read-only label that
  // only appears once a level is set (Directors tab).
  const levelChip = opts.interactive
    ? el("button", {
        type: "button",
        class: `chip chip--level director-film__rate${level ? ` chip--level-${level}` : " director-film__rate--empty"}`,
        dataset: { action: "cycle-interest", key, tmdbId: m.tmdb_id ? String(m.tmdb_id) : "", title: m.title || "", date: m.date || "" },
        "aria-label": level ? `Interest: ${LEVEL_LABEL[level]}. Tap to change.` : "Set interest",
      }, level ? LEVEL_LABEL[level] : "Rate")
    : (level ? el("span", { class: `chip chip--level chip--level-${level}`, text: LEVEL_LABEL[level] }) : null);
  return el("li", { class: `director-film${level ? ` director-film--${level}` : ""}` },
    titleLink,
    el("div", { class: "director-film__meta" },
      dateLabel ? el("span", { class: "director-film__date", text: dateLabel }) : null,
      el("span", { class: chipClass(m.release_type), text: chipLabel(m.release_type) }),
      levelChip,
    ),
  );
}

// Track which directors the user has expanded (to reveal filmography + edit/
// remove). Persisted across sessions because a long Directors list is hard
// to re-navigate otherwise.
const DIR_EXPANDED_KEY = "upcoming:directors-expanded";
const expandedDirectors = (() => {
  try {
    const raw = localStorage.getItem(DIR_EXPANDED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
})();
function saveExpandedDirectors() {
  try { localStorage.setItem(DIR_EXPANDED_KEY, JSON.stringify([...expandedDirectors])); } catch {}
}

// Per-film watched state piggybacks on the Interests storage so it syncs
// to GitHub alongside the user's other marks. The key is the same
// `tmdb:${id}` format the rest of the app uses for movies, which means a
// film that's BOTH on the local schedule and in a director's filmography
// shares a single watched state across both surfaces.
const filmWatchedKey = (film) => `tmdb:${film.id}`;
const isFilmWatched = (film) => Interests.getLevel(filmWatchedKey(film)) === "watched";

const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-11"/></svg>`;

function renderFilmographyFilm(film) {
  const watched = isFilmWatched(film);
  const btn = el("button", {
    type: "button",
    class: "director-year__check",
    dataset: { action: "toggle-watched", tmdbId: String(film.id) },
    "aria-pressed": watched ? "true" : "false",
    "aria-label": watched ? "Mark unwatched" : "Mark watched",
  });
  btn.innerHTML = CHECK_SVG;
  return el("li", { class: `director-year__film${watched ? " is-watched" : ""}` },
    btn,
    el("span", { class: "director-year__film-title", text: film.title }),
  );
}

function renderFilmographyYearGroups(films) {
  const buckets = new Map();
  for (const f of films) {
    const year = f.date ? f.date.slice(0, 4) : "—";
    if (!buckets.has(year)) buckets.set(year, []);
    buckets.get(year).push(f);
  }
  // Sort years descending; "—" (unknown) sorts to the end.
  const years = [...buckets.keys()].sort((a, b) => {
    if (a === "—") return 1;
    if (b === "—") return -1;
    return b.localeCompare(a);
  });
  return years.map((y) =>
    el("div", { class: "director-year" },
      el("div", { class: "director-year__label", text: y }),
      el("ul", { class: "director-year__films" },
        ...buckets.get(y).map(renderFilmographyFilm)
      ),
    )
  );
}

function filmographyTallyText(films) {
  const seen = films.filter(isFilmWatched).length;
  return `${seen} of ${films.length} watched`;
}

function paintFilmography(container, state) {
  container.innerHTML = "";
  if (state.kind === "loading") {
    container.appendChild(el("p", { class: "director-filmography__status", text: "Loading filmography…" }));
    return;
  }
  if (state.kind === "no-token") {
    container.appendChild(
      el("div", { class: "director-filmography__connect" },
        el("p", { class: "director-filmography__connect-copy",
          text: "Connect TMDB to see this director's full feature history." }),
        el("button", { type: "button", class: "rep-card-action", dataset: { action: "connect-tmdb" } }, "Connect TMDB"),
      )
    );
    return;
  }
  if (state.kind === "error") {
    container.appendChild(el("p", { class: "director-filmography__status", text: state.message }));
    return;
  }
  if (state.kind === "films") {
    const films = state.films || [];
    const rumored = state.rumored || [];
    if (!films.length && !rumored.length) {
      container.appendChild(el("p", { class: "director-filmography__status", text: "No directing credits on TMDB." }));
      return;
    }
    // One tally for the whole director, updated in place on watched toggles.
    // Always present so toggling never adds/removes an element (which would
    // shift the rows below).
    container.appendChild(el("p", { class: "director-filmography__tally", text: filmographyTallyText(films) }));
    if (rumored.length) {
      container.appendChild(el("div", { class: "director-rumored" },
        el("div", { class: "director-rumored__label", text: "Rumored / In development" }),
        el("ul", { class: "director-rumored__list" },
          ...rumored.map(renderTmdbUpcomingFilm),
        ),
      ));
    }
    for (const group of renderFilmographyYearGroups(films)) {
      container.appendChild(group);
    }
  }
}

// Map a TMDB movie `status` to a short, human-readable chip label. Unknown
// or future-but-undated entries fall back to "Upcoming".
const TMDB_STATUS_CHIP = {
  "Rumored": { label: "Rumored", className: "chip chip--rumored" },
  "Planned": { label: "Planned", className: "chip chip--rumored" },
  "In Production": { label: "Filming", className: "chip chip--in-production" },
  "Post Production": { label: "Post-prod", className: "chip chip--in-production" },
  "Released": { label: "Upcoming", className: "chip chip--upcoming" },
};
function statusChipFor(status) {
  return TMDB_STATUS_CHIP[status] || { label: "Upcoming", className: "chip chip--upcoming" };
}

function renderTmdbUpcomingFilm(film) {
  const chip = statusChipFor(film.status);
  const titleLink = el("a", {
      class: "director-film__title",
      href: wikipediaUrl(film.title, film.date),
      target: "_blank",
      rel: "noopener noreferrer",
    },
    film.title,
  );
  // TMDB-only films have no theatrical date yet; show the year (or "TBD"
  // when even the year is unknown) so the user can place the project in time.
  const whenLabel = film.year || "TBD";
  return el("li", { class: "director-film director-film--tmdb" },
    titleLink,
    el("div", { class: "director-film__meta" },
      el("span", { class: "director-film__date", text: whenLabel }),
      el("span", { class: chip.className, text: chip.label }),
    ),
  );
}

// Patch in TMDB-derived bits of a director's row after the network resolves:
// the profile thumbnail, the "Latest: …" hint, and any upcoming/rumored
// films deduped against the local schedule. Cache-then-network: cached
// entries paint immediately, and a follow-up refresh paints again if newer
// data arrives.
function loadDirectorTmdbInto(rowEl, filmsListEl, nofilmsEl, directorName, localTmdbIds) {
  if (!rowEl || !Tmdb.hasToken()) return;
  const paint = (entry) => {
    if (!entry || !rowEl.isConnected) return;

    // Photo: swap the initials placeholder for the real thumbnail.
    const url = Tmdb.profileImageUrl(entry.profilePath);
    const photoEl = rowEl.querySelector(".director-row__photo");
    if (url && photoEl && photoEl.tagName !== "IMG") {
      const img = el("img", {
        class: "director-row__photo",
        src: url, alt: "", loading: "lazy", decoding: "async",
      });
      photoEl.replaceWith(img);
    } else if (url && photoEl?.tagName === "IMG" && photoEl.getAttribute("src") !== url) {
      photoEl.setAttribute("src", url);
    }

    // Latest hint: insert or update.
    const latest = entry.released?.[0];
    if (latest?.title) {
      const year = latest.year || (latest.date ? latest.date.slice(0, 4) : "");
      const text = year ? `Latest: ${latest.title} · ${year}` : `Latest: ${latest.title}`;
      let latestEl = rowEl.querySelector(".director-row__latest");
      if (!latestEl) {
        latestEl = el("p", { class: "director-row__latest", text });
        const after = rowEl.querySelector(".director-row__notes")
          || rowEl.querySelector(".director-row__name");
        after?.after(latestEl);
      } else {
        latestEl.textContent = text;
      }
    }

    // Confirmed-only inline: a TMDB film qualifies for the quick view only
    // when it has a real release_date AND isn't flagged Rumored / Planned.
    // Undated and speculative entries surface inside the expanded
    // filmography instead. (See loadFilmographyInto.)
    if (filmsListEl) {
      filmsListEl.querySelectorAll(".director-film--tmdb").forEach((n) => n.remove());
      const isConfirmed = (f) =>
        f.date && f.status !== "Rumored" && f.status !== "Planned";
      const fresh = (entry.upcoming || [])
        .filter((f) => f.title && !localTmdbIds.has(f.id) && isConfirmed(f));
      for (const f of fresh) filmsListEl.appendChild(renderTmdbUpcomingFilm(f));
      if (nofilmsEl) nofilmsEl.hidden = filmsListEl.children.length > 0;
    }

    // Stats fraction in the rank column (e.g. "5/16") — only meaningful
    // once we have a real filmography, so update it post-fetch too.
    const statsEl = rowEl.querySelector(".director-row__stats");
    if (statsEl && Array.isArray(entry.released)) {
      const seen = entry.released.filter(isFilmWatched).length;
      const total = entry.released.length;
      if (total) {
        statsEl.textContent = `${seen}/${total}`;
        statsEl.hidden = false;
      }
    }
  };
  Tmdb.getFilmography(directorName, (err, fresh) => {
    if (err || !rowEl.isConnected) return;
    paint(fresh);
  })
    .then((entry) => { if (entry) paint(entry); })
    .catch(() => {});
}

function tmdbErrorToState(err, name) {
  const msg = err?.message || "";
  if (msg === "no-token") return { kind: "no-token" };
  if (msg === "bad-token") return { kind: "error", message: "TMDB rejected the token. Reconnect to fix." };
  if (msg === "not-found") return { kind: "error", message: `No TMDB match for "${name}".` };
  return { kind: "error", message: "Couldn't load filmography. Check your connection." };
}

// A TMDB upcoming film qualifies as "rumored / in development" — and lives
// only in the expanded view — if it's undated OR explicitly flagged as
// Rumored / Planned. Anything with a real release date that isn't speculation
// stays inline in the quick view.
const isRumoredFilm = (f) =>
  !f.date || f.status === "Rumored" || f.status === "Planned";

async function loadFilmographyInto(container, name) {
  const paintFromEntry = (entry) => {
    const films = entry?.released || [];
    const rumored = (entry?.upcoming || []).filter(isRumoredFilm);
    paintFilmography(container, { kind: "films", films, rumored });
  };
  if (!Tmdb.hasToken()) {
    const cached = Tmdb.getCached(name);
    if (cached?.released?.length || cached?.upcoming?.length) {
      paintFromEntry(cached);
      return;
    }
    paintFilmography(container, { kind: "no-token" });
    return;
  }
  paintFilmography(container, { kind: "loading" });
  try {
    const entry = await Tmdb.getFilmography(name, (err, fresh) => {
      // Background refresh after a stale-cache paint.
      if (err || !container.isConnected) return;
      paintFromEntry(fresh);
    });
    if (entry) {
      paintFromEntry(entry);
    } else {
      paintFilmography(container, { kind: "error", message: "No filmography returned." });
    }
  } catch (err) {
    paintFilmography(container, tmdbErrorToState(err, name));
  }
}

// Search filter applied to the visible Directors list. Stored at module
// scope so it survives between renders (e.g. interest toggles re-render the
// tab and shouldn't drop the user's filter). Reset on dialog close isn't
// needed — typing into the search input flows through setDirectorSearch.
let directorSearchQuery = "";

const setDirectorSearch = (value) => {
  const next = normalizeDirectorName(value);
  if (next === directorSearchQuery) return;
  directorSearchQuery = next;
  const clearBtn = document.getElementById("director-search-clear");
  if (clearBtn) clearBtn.hidden = !value;
  if (activeTab === "directors") renderDirectorsTab();
  else tabDirty.directors = true;
};

const matchesDirectorSearch = (d) => {
  if (!directorSearchQuery) return true;
  const hay = normalizeDirectorName(`${d.name} ${d.notes || ""}`);
  return hay.includes(directorSearchQuery);
};

const initialsFor = (name) =>
  String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || "")
    .join("")
    .toUpperCase();

function directorLatestText(name) {
  const cached = Tmdb.getCached(name);
  const film = cached?.released?.[0];
  if (!film?.title) return "";
  const year = film.year || (film.date ? film.date.slice(0, 4) : "");
  return year ? `Latest: ${film.title} · ${year}` : `Latest: ${film.title}`;
}

// Compact at-a-glance "watched / total" indicator for the collapsed row.
// Returns empty string when no filmography cache exists yet (i.e. before the
// background TMDB fetch lands) so we don't show a misleading 0/0.
function directorStatsText(name) {
  const cached = Tmdb.getCached(name);
  const films = cached?.released;
  if (!Array.isArray(films) || !films.length) return "";
  const seen = films.filter(isFilmWatched).length;
  return `${seen}/${films.length}`;
}

function renderRankPhoto(d, rank) {
  const cached = Tmdb.getCached(d.name);
  const url = Tmdb.profileImageUrl(cached?.profilePath);
  const photo = url
    ? el("img", { class: "director-row__photo", src: url, alt: "", loading: "lazy", decoding: "async" })
    : el("div", { class: "director-row__photo director-row__photo--placeholder", text: initialsFor(d.name) });
  const stats = directorStatsText(d.name);
  return el("div", { class: "director-row__rank-col" },
    photo,
    el("span", { class: "director-row__rank", text: String(rank) }),
    el("span", { class: "director-row__stats", text: stats, hidden: !stats }),
  );
}

function renderDirectorsTab() {
  const list = document.getElementById("director-list");
  const empty = document.getElementById("empty-directors");
  const emptySearch = document.getElementById("empty-directors-search");
  if (!list || !empty) return;
  list.innerHTML = "";
  const items = Directors.all();
  if (!items.length) {
    empty.hidden = false;
    if (emptySearch) emptySearch.hidden = true;
    return;
  }
  empty.hidden = true;

  let shown = 0;
  items.forEach((d, idx) => {
    if (!matchesDirectorSearch(d)) return;
    shown++;
    const upBtn = el("button", {
      type: "button",
      class: "director-move director-move--up",
      "aria-label": "Move up",
      dataset: { id: d.id, dir: "-1" },
    });
    upBtn.innerHTML = CHEVRON_UP_SVG;
    if (idx === 0) upBtn.setAttribute("disabled", "");

    const downBtn = el("button", {
      type: "button",
      class: "director-move director-move--down",
      "aria-label": "Move down",
      dataset: { id: d.id, dir: "1" },
    });
    downBtn.innerHTML = CHEVRON_DOWN_SVG;
    if (idx === items.length - 1) downBtn.setAttribute("disabled", "");

    const films = moviesForDirector(d.name);
    const localTmdbIds = new Set(films.map((f) => f.tmdb_id).filter(Boolean));
    // Always render the UL — TMDB upcoming/rumored entries can append into it
    // even when the local schedule is empty.
    const filmsList = el("ul", { class: "director-films" }, ...films.map(renderDirectorFilm));
    const nofilms = el("p", {
      class: "director-row__nofilms",
      text: "No upcoming films in the schedule.",
      hidden: films.length > 0,
    });

    const expanded = expandedDirectors.has(d.id);

    const filmographyEl = el("div", {
      class: "director-filmography",
      dataset: { directorId: d.id },
      hidden: !expanded,
    });

    const detailActions = el("div", {
      class: "director-row__detail-actions",
      hidden: !expanded,
    },
      el("button", { type: "button", class: "rep-card-action", dataset: { action: "edit", id: d.id } }, "Edit"),
      el("button", { type: "button", class: "rep-card-action rep-card-action--ghost", dataset: { action: "remove", id: d.id } }, "Remove"),
    );

    const expandBtn = el("button", {
      type: "button",
      class: "director-row__expand",
      dataset: { action: "toggle-expand", id: d.id },
      "aria-expanded": expanded ? "true" : "false",
    },
      el("span", { text: expanded ? "Hide details" : "Show filmography" }),
    );
    expandBtn.insertAdjacentHTML("beforeend", CHEVRON_DOWN_SVG);

    const latestText = directorLatestText(d.name);
    const body = el("div", { class: "director-row__body" },
      el("h3", { class: "director-row__name", text: d.name }),
      d.notes ? el("p", { class: "director-row__notes", text: d.notes }) : null,
      latestText ? el("p", { class: "director-row__latest", text: latestText }) : null,
      filmsList,
      nofilms,
      expandBtn,
    );

    // The filmography and detail-actions are siblings of body in the grid so
    // they can span all three columns when expanded — gives long titles the
    // full row width to lay out on a single line.
    const row = el("li", {
        class: "director-row",
        dataset: { id: d.id, expanded: expanded ? "true" : "false" },
      },
      renderRankPhoto(d, idx + 1),
      body,
      el("div", { class: "director-row__actions" }, upBtn, downBtn),
      filmographyEl,
      detailActions,
    );
    list.appendChild(row);

    // Background-enrich the row with TMDB data: in-flight upcoming titles
    // appended to the films list, plus photo + latest hint that paint over
    // the placeholders once the person fetch resolves.
    loadDirectorTmdbInto(row, filmsList, nofilms, d.name, localTmdbIds);

    // Kick off filmography load if the row starts expanded (restored from
    // localStorage). Lets the cached payload paint on first render.
    if (expanded) loadFilmographyInto(filmographyEl, d.name);
  });

  if (emptySearch) emptySearch.hidden = shown > 0 || !directorSearchQuery;
}

function toggleDirectorExpand(id) {
  const row = document.querySelector(`.director-row[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  const filmography = row.querySelector(".director-filmography");
  const actions = row.querySelector(".director-row__detail-actions");
  const button = row.querySelector(".director-row__expand");
  const label = button?.querySelector("span");
  const willExpand = !expandedDirectors.has(id);
  if (willExpand) expandedDirectors.add(id);
  else expandedDirectors.delete(id);
  saveExpandedDirectors();

  row.dataset.expanded = willExpand ? "true" : "false";
  if (filmography) filmography.hidden = !willExpand;
  if (actions) actions.hidden = !willExpand;
  if (button) button.setAttribute("aria-expanded", willExpand ? "true" : "false");
  if (label) label.textContent = willExpand ? "Hide details" : "Show filmography";

  if (willExpand && filmography) {
    const director = Directors.all().find((d) => d.id === id);
    if (director) loadFilmographyInto(filmography, director.name);
  }
}

document.getElementById("director-list")?.addEventListener("click", (e) => {
  const moveBtn = e.target.closest(".director-move");
  if (moveBtn) {
    if (moveBtn.hasAttribute("disabled")) return;
    const id = moveBtn.dataset.id;
    const delta = Number(moveBtn.dataset.dir);
    if (!id || (delta !== 1 && delta !== -1)) return;
    if (Directors.move(id, delta)) renderDirectorsTab();
    return;
  }
  const expandBtn = e.target.closest('[data-action="toggle-expand"]');
  if (expandBtn) {
    const id = expandBtn.dataset.id;
    if (id) toggleDirectorExpand(id);
    return;
  }
  const editBtn = e.target.closest('[data-action="edit"]');
  if (editBtn) {
    const id = editBtn.dataset.id;
    if (id) openDirectorDialog(id);
    return;
  }
  const removeBtn = e.target.closest('[data-action="remove"]');
  if (removeBtn) {
    const id = removeBtn.dataset.id;
    if (id) Directors.remove(id);
    return;
  }
  const connectBtn = e.target.closest('[data-action="connect-tmdb"]');
  if (connectBtn) {
    openTmdbDialog();
    return;
  }
  const watchedBtn = e.target.closest('[data-action="toggle-watched"]');
  if (watchedBtn) {
    const id = watchedBtn.dataset.tmdbId;
    if (!id) return;
    const key = `tmdb:${id}`;
    const next = Interests.getLevel(key) === "watched" ? null : "watched";
    Interests.set(key, next);
    // Patch the affected film row in place: class toggle for the strike-
    // through, aria for assistive tech, and a one-shot "is-pulse" class on
    // the check itself so the tap registers visually without shifting any
    // surrounding rows.
    const filmEl = watchedBtn.closest(".director-year__film");
    if (filmEl) filmEl.classList.toggle("is-watched", next === "watched");
    watchedBtn.setAttribute("aria-pressed", next === "watched" ? "true" : "false");
    watchedBtn.setAttribute("aria-label", next === "watched" ? "Mark unwatched" : "Mark watched");
    watchedBtn.classList.remove("is-pulse");
    // Force a reflow so the keyframe restarts even on rapid re-taps.
    void watchedBtn.offsetWidth;
    watchedBtn.classList.add("is-pulse");
    // Director-wide tally: recount the whole filmography and update the
    // single header line. Always-present text node means no layout shift.
    // Also patch the collapsed-view stats fraction in the rank column so
    // the quick view reflects the new mark without a full re-render.
    const rowEl = watchedBtn.closest(".director-row");
    const filmographyEl = rowEl?.querySelector(".director-filmography");
    if (filmographyEl) {
      const total = filmographyEl.querySelectorAll(".director-year__film").length;
      const seen = filmographyEl.querySelectorAll(".director-year__film.is-watched").length;
      const tallyEl = filmographyEl.querySelector(".director-filmography__tally");
      if (tallyEl) tallyEl.textContent = `${seen} of ${total} watched`;
      const statsEl = rowEl.querySelector(".director-row__stats");
      if (statsEl && total) {
        statsEl.textContent = `${seen}/${total}`;
        statsEl.hidden = false;
      }
    }
  }
});

document.getElementById("add-director")?.addEventListener("click", () => {
  openDirectorDialog(null);
});

// Directors-tab search input. Filters the visible list as the user types;
// the rank number stays the user's original ranking (not the filtered index).
const directorSearchInput = document.getElementById("director-search-input");
const directorSearchClear = document.getElementById("director-search-clear");
directorSearchInput?.addEventListener("input", (e) => {
  const value = e.target.value;
  if (directorSearchClear) directorSearchClear.hidden = !value;
  setDirectorSearch(value);
});
directorSearchClear?.addEventListener("click", () => {
  if (!directorSearchInput) return;
  directorSearchInput.value = "";
  directorSearchClear.hidden = true;
  setDirectorSearch("");
  directorSearchInput.focus();
});

// Filter the local director index for autocomplete suggestions, excluding any
// director the user has already added. Substring match against normalized
// names so accents/case/punctuation don't trip the user up.
function suggestDirectors(query) {
  const q = normalizeDirectorName(query);
  if (!q || q.length < 2) return [];
  const saved = new Set(Directors.all().map((d) => normalizeDirectorName(d.name)));
  const hits = [];
  for (const entry of directorDisplayList) {
    if (saved.has(entry.key)) continue;
    if (entry.key.includes(q)) hits.push(entry);
    if (hits.length >= 8) break;
  }
  return hits;
}

function openDirectorDialog(id) {
  const dlg = document.getElementById("director-dialog");
  const form = document.getElementById("director-form");
  const titleEl = document.getElementById("director-title");
  const nameInput = document.getElementById("director-name");
  const notesInput = document.getElementById("director-notes");
  const cancel = document.getElementById("director-cancel");
  const remove = document.getElementById("director-remove");
  const suggList = document.getElementById("director-suggestions");
  if (!dlg || !form) return;

  const existing = id ? Directors.all().find((d) => d.id === id) : null;
  titleEl.textContent = existing ? "Edit director" : "Add director";
  nameInput.value = existing?.name || "";
  notesInput.value = existing?.notes || "";
  remove.hidden = !existing;
  if (suggList) {
    suggList.innerHTML = "";
    suggList.hidden = true;
  }

  dlg.showModal();
  requestAnimationFrame(() => nameInput.focus());

  // Sequence number for in-flight TMDB search requests; later inputs win,
  // earlier responses are ignored so a slow network can't clobber the list
  // after the user has typed more.
  let querySeq = 0;
  let inputDebounce = null;

  const paintSuggestions = (items) => {
    if (!suggList) return;
    suggList.innerHTML = "";
    if (!items.length) { suggList.hidden = true; return; }
    for (const h of items) {
      const li = el("li", {
          class: "director-suggestion",
          dataset: { name: h.name },
        },
        el("span", { class: "director-suggestion__name", text: h.name }),
        h.hint ? el("span", { class: "director-suggestion__count", text: h.hint }) : null,
      );
      suggList.appendChild(li);
    }
    suggList.hidden = false;
  };

  const renderSuggestions = () => {
    if (!suggList) return;
    // Don't suggest when editing — the user explicitly opened this director
    // to change their notes, not to swap them for a different person.
    if (existing) { suggList.hidden = true; return; }
    const seq = ++querySeq;
    const q = nameInput.value;
    const trimmed = q.trim();
    const saved = new Set(Directors.all().map((d) => normalizeDirectorName(d.name)));

    // Paint local matches immediately for snappy feedback. TMDB enriches.
    const local = suggestDirectors(q);
    paintSuggestions(local.map((e) => ({ name: e.name, hint: `${e.count} upcoming` })));

    if (!Tmdb.hasToken() || trimmed.length < 2) return;

    Tmdb.searchPeople(trimmed).then((people) => {
      if (seq !== querySeq) return;
      const hits = people
        .filter((p) => !saved.has(normalizeDirectorName(p.name)))
        .map((p) => ({
          name: p.name,
          hint: p.knownFor || (p.department && p.department !== "Directing" ? p.department : ""),
        }));
      // Only overwrite the local list if TMDB actually returned hits —
      // otherwise an unrelated 0-result search would erase useful local
      // matches the user could pick from.
      if (hits.length) paintSuggestions(hits);
    }).catch(() => {
      // Network/auth error: keep whatever's already painted from local.
    });
  };

  const onInput = () => {
    clearTimeout(inputDebounce);
    inputDebounce = setTimeout(renderSuggestions, 250);
  };

  // Use mousedown so the click fires before the input blurs (which would
  // hide the list before the handler ran).
  const onSuggestClick = (e) => {
    const li = e.target.closest(".director-suggestion");
    if (!li) return;
    e.preventDefault();
    nameInput.value = li.dataset.name || "";
    if (suggList) suggList.hidden = true;
    notesInput.focus();
  };

  const cleanup = () => {
    cancel.removeEventListener("click", onCancel);
    remove.removeEventListener("click", onRemove);
    form.removeEventListener("submit", onSubmit);
    dlg.removeEventListener("cancel", onEsc);
    nameInput.removeEventListener("input", onInput);
    suggList?.removeEventListener("mousedown", onSuggestClick);
    clearTimeout(inputDebounce);
    querySeq++;
  };
  const onCancel = () => { dlg.close(); cleanup(); };
  const onEsc = (e) => { e.preventDefault(); onCancel(); };
  const onRemove = () => {
    if (existing) Directors.remove(existing.id);
    dlg.close();
    cleanup();
  };
  const onSubmit = (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    const notes = notesInput.value.trim();
    if (existing) Directors.update(existing.id, { name, notes });
    else Directors.add(name, notes);
    dlg.close();
    cleanup();
  };

  cancel.addEventListener("click", onCancel);
  remove.addEventListener("click", onRemove);
  form.addEventListener("submit", onSubmit);
  dlg.addEventListener("cancel", onEsc);
  nameInput.addEventListener("input", onInput);
  suggList?.addEventListener("mousedown", onSuggestClick);
}

function openTmdbDialog() {
  const dlg = document.getElementById("tmdb-dialog");
  const form = document.getElementById("tmdb-form");
  const input = document.getElementById("tmdb-input");
  const cancel = document.getElementById("tmdb-cancel");
  const remove = document.getElementById("tmdb-remove");
  if (!dlg || !form) return;

  input.value = Tmdb.getToken() || "";
  remove.hidden = !Tmdb.hasToken();
  dlg.showModal();
  requestAnimationFrame(() => input.focus());

  const cleanup = () => {
    cancel.removeEventListener("click", onCancel);
    remove.removeEventListener("click", onRemove);
    form.removeEventListener("submit", onSubmit);
    dlg.removeEventListener("cancel", onEsc);
  };
  const onCancel = () => { dlg.close(); cleanup(); };
  const onEsc = (e) => { e.preventDefault(); onCancel(); };
  const onRemove = () => {
    Tmdb.setToken(null);
    dlg.close();
    cleanup();
    if (activeTab === "directors") renderDirectorsTab();
  };
  const onSubmit = (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    Tmdb.setToken(v);
    dlg.close();
    cleanup();
    // Re-render so any "Connect TMDB" prompts refresh into loading states.
    if (activeTab === "directors") renderDirectorsTab();
  };

  cancel.addEventListener("click", onCancel);
  remove.addEventListener("click", onRemove);
  form.addEventListener("submit", onSubmit);
  dlg.addEventListener("cancel", onEsc);
}

Directors.onChange(() => {
  if (activeTab === "directors") renderDirectorsTab();
  else tabDirty.directors = true;
});

// ---------- Studios tab ----------
//
// Mirrors the Directors tab structure (reusing its row / film-list styles)
// but is purely local: it groups the schedule's releases by their `studio`
// field rather than enriching from TMDB. Each studio shows its upcoming
// releases inline and its recent (already-released) ones on expand.

// Lookup of normalized studio name → releases in the loaded schedule. Built
// once after loadYear settles, alongside the director index.
const studioIndex = new Map();
// Distinct studios seen in the data (display spelling preserved), for the
// Add-studio autocomplete.
const studioDisplayList = [];

const normalizeStudioName = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    // Strip punctuation that varies between listings ("Warner Bros." vs
    // "Warner Bros", ampersands, hyphens). Keep digits ("20th Century").
    .replace(/[.,'’&\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function buildStudioIndex(bundles) {
  studioIndex.clear();
  const displayByKey = new Map();
  for (const bundle of bundles || []) {
    for (const release of bundle.releases || []) {
      const raw = release.studio;
      if (!raw || raw === "—" || raw === "N/A") continue;
      const key = normalizeStudioName(raw);
      if (!key) continue;
      if (!studioIndex.has(key)) studioIndex.set(key, []);
      studioIndex.get(key).push(release);
      if (!displayByKey.has(key)) displayByKey.set(key, raw.trim());
    }
  }
  for (const list of studioIndex.values()) {
    list.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }
  studioDisplayList.length = 0;
  for (const [key, name] of displayByKey) {
    studioDisplayList.push({ key, name, count: studioIndex.get(key).length });
  }
  studioDisplayList.sort((a, b) => a.name.localeCompare(b.name));
}

// All releases matching a studio entry — its `name` plus any `aliases` —
// de-duplicated and split into upcoming (today onward) and recent (before
// today, most-recent first).
function moviesForStudio(entry) {
  const keys = [entry.name, ...(entry.aliases || [])]
    .map(normalizeStudioName)
    .filter(Boolean);
  const seen = new Set();
  const films = [];
  for (const key of keys) {
    for (const m of studioIndex.get(key) || []) {
      const k = movieKey(m);
      if (seen.has(k)) continue;
      seen.add(k);
      films.push(m);
    }
  }
  const upcoming = films
    .filter((m) => (m.date || "") >= TODAY)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const recent = films
    .filter((m) => (m.date || "") < TODAY)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return { upcoming, recent };
}

// Persisted set of expanded studio rows (mirrors expandedDirectors).
const STUDIO_EXPANDED_KEY = "upcoming:studios-expanded";
const expandedStudios = (() => {
  try {
    const raw = localStorage.getItem(STUDIO_EXPANDED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
})();
function saveExpandedStudios() {
  try { localStorage.setItem(STUDIO_EXPANDED_KEY, JSON.stringify([...expandedStudios])); } catch {}
}

let studioSearchQuery = "";
const setStudioSearch = (value) => {
  const next = normalizeStudioName(value);
  if (next === studioSearchQuery) return;
  studioSearchQuery = next;
  const clearBtn = document.getElementById("studio-search-clear");
  if (clearBtn) clearBtn.hidden = !value;
  if (activeTab === "studios") renderStudiosTab();
  else tabDirty.studios = true;
};
const matchesStudioSearch = (s) => {
  if (!studioSearchQuery) return true;
  const hay = normalizeStudioName(`${s.name} ${(s.aliases || []).join(" ")} ${s.notes || ""}`);
  return hay.includes(studioSearchQuery);
};

function renderStudiosTab() {
  const list = document.getElementById("studio-list");
  const empty = document.getElementById("empty-studios");
  const emptySearch = document.getElementById("empty-studios-search");
  if (!list || !empty) return;
  list.innerHTML = "";
  const items = Studios.all();
  if (!items.length) {
    empty.hidden = false;
    if (emptySearch) emptySearch.hidden = true;
    return;
  }
  empty.hidden = true;

  let shown = 0;
  items.forEach((s, idx) => {
    if (!matchesStudioSearch(s)) return;
    shown++;
    const { upcoming, recent } = moviesForStudio(s);
    const expanded = expandedStudios.has(s.id);

    const upBtn = el("button", {
      type: "button",
      class: "director-move director-move--up",
      "aria-label": "Move up",
      dataset: { id: s.id, dir: "-1" },
    });
    upBtn.innerHTML = CHEVRON_UP_SVG;
    if (idx === 0) upBtn.setAttribute("disabled", "");

    const downBtn = el("button", {
      type: "button",
      class: "director-move director-move--down",
      "aria-label": "Move down",
      dataset: { id: s.id, dir: "1" },
    });
    downBtn.innerHTML = CHEVRON_DOWN_SVG;
    if (idx === items.length - 1) downBtn.setAttribute("disabled", "");

    const countChip = el("div", { class: "director-row__rank-col" },
      el("div", {
        class: `director-row__photo director-row__photo--placeholder studio-row__count${upcoming.length ? "" : " studio-row__count--empty"}`,
        text: String(upcoming.length),
      }),
      el("span", { class: "studio-row__count-label", text: "ahead" }),
    );

    // Collapsed by default: the header (count chip + name) is always shown,
    // and the upcoming + recent release lists live in one collapsible
    // section so a long studio list stays scannable.
    const expandBtn = el("button", {
      type: "button",
      class: "director-row__expand",
      dataset: { action: "toggle-expand", id: s.id, upcoming: String(upcoming.length), recent: String(recent.length) },
      "aria-expanded": expanded ? "true" : "false",
    },
      el("span", { text: expanded ? "Hide releases" : studioSummary(upcoming.length, recent.length) }),
    );
    expandBtn.insertAdjacentHTML("beforeend", CHEVRON_DOWN_SVG);

    const body = el("div", { class: "director-row__body" },
      el("h3", { class: "director-row__name", dataset: { action: "toggle-expand", id: s.id }, text: s.name }),
      s.notes ? el("p", { class: "director-row__notes", text: s.notes }) : null,
      expandBtn,
    );

    const details = el("div", {
        class: "director-filmography",
        dataset: { studioId: s.id },
        hidden: !expanded,
      },
      el("p", { class: "studio-section__label", text: "Upcoming" }),
      upcoming.length
        ? el("ul", { class: "director-films" }, ...upcoming.map((m) => renderDirectorFilm(m, { interactive: true })))
        : el("p", { class: "director-row__nofilms", text: "No upcoming releases on the schedule." }),
      el("p", { class: "studio-section__label", text: "Recent releases" }),
      recent.length
        ? el("ul", { class: "director-films" }, ...recent.map((m) => renderDirectorFilm(m, { interactive: true })))
        : el("p", { class: "director-row__nofilms", text: "No recent releases this year." }),
    );

    const detailActions = el("div", {
      class: "director-row__detail-actions",
      hidden: !expanded,
    },
      el("button", { type: "button", class: "rep-card-action", dataset: { action: "edit", id: s.id } }, "Edit"),
      el("button", { type: "button", class: "rep-card-action rep-card-action--ghost", dataset: { action: "remove", id: s.id } }, "Remove"),
    );

    const row = el("li", {
        class: "director-row",
        dataset: { id: s.id, expanded: expanded ? "true" : "false" },
      },
      countChip,
      body,
      el("div", { class: "director-row__actions" }, upBtn, downBtn),
      details,
      detailActions,
    );
    list.appendChild(row);
  });

  if (emptySearch) emptySearch.hidden = shown > 0 || !studioSearchQuery;
}

// Collapsed-row summary line, e.g. "9 upcoming · 4 recent". Drops a zeroed
// half so a studio with nothing recent reads "9 upcoming", not "9 · 0".
function studioSummary(upcoming, recent) {
  const parts = [];
  parts.push(`${upcoming} upcoming`);
  if (recent) parts.push(`${recent} recent`);
  return parts.join(" · ");
}

function toggleStudioExpand(id) {
  const row = document.querySelector(`#studio-list .director-row[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  const section = row.querySelector(".director-filmography");
  const actions = row.querySelector(".director-row__detail-actions");
  const button = row.querySelector(".director-row__expand");
  const label = button?.querySelector("span");
  const willExpand = !expandedStudios.has(id);
  if (willExpand) expandedStudios.add(id);
  else expandedStudios.delete(id);
  saveExpandedStudios();

  row.dataset.expanded = willExpand ? "true" : "false";
  if (section) section.hidden = !willExpand;
  if (actions) actions.hidden = !willExpand;
  if (button) button.setAttribute("aria-expanded", willExpand ? "true" : "false");
  if (label) {
    label.textContent = willExpand
      ? "Hide releases"
      : studioSummary(Number(button?.dataset.upcoming) || 0, Number(button?.dataset.recent) || 0);
  }
}

// Tap-to-cycle interest order for the studio film chips. Skips booked /
// watched, which need a date dialog and stay on the List tab; after "not"
// the next tap clears the mark.
const INTEREST_CYCLE = ["must", "likely", "potential", "not"];

async function cycleStudioInterest(btn) {
  const key = btn.dataset.key;
  if (!key) return;
  if (!Interests.hasPat()) {
    const saved = await requestPat();
    if (!saved) return;
  }
  const current = Interests.getLevel(key);
  const i = INTEREST_CYCLE.indexOf(current);
  const next = i === -1 ? INTEREST_CYCLE[0] : (i + 1 < INTEREST_CYCLE.length ? INTEREST_CYCLE[i + 1] : null);
  const meta = {
    title: btn.dataset.title || "",
    date: btn.dataset.date || "",
    tmdb_id: btn.dataset.tmdbId ? Number(btn.dataset.tmdbId) : null,
  };
  Interests.set(key, next, meta);
}

document.getElementById("studio-list")?.addEventListener("click", (e) => {
  const rateBtn = e.target.closest('[data-action="cycle-interest"]');
  if (rateBtn) {
    e.preventDefault();
    cycleStudioInterest(rateBtn);
    return;
  }
  const moveBtn = e.target.closest(".director-move");
  if (moveBtn) {
    if (moveBtn.hasAttribute("disabled")) return;
    const id = moveBtn.dataset.id;
    const delta = Number(moveBtn.dataset.dir);
    if (!id || (delta !== 1 && delta !== -1)) return;
    if (Studios.move(id, delta)) renderStudiosTab();
    return;
  }
  const expandBtn = e.target.closest('[data-action="toggle-expand"]');
  if (expandBtn) {
    const id = expandBtn.dataset.id;
    if (id) toggleStudioExpand(id);
    return;
  }
  const editBtn = e.target.closest('[data-action="edit"]');
  if (editBtn) {
    const id = editBtn.dataset.id;
    if (id) openStudioDialog(id);
    return;
  }
  const removeBtn = e.target.closest('[data-action="remove"]');
  if (removeBtn) {
    const id = removeBtn.dataset.id;
    if (id) Studios.remove(id);
    return;
  }
});

document.getElementById("add-studio")?.addEventListener("click", () => {
  openStudioDialog(null);
});

const studioSearchInput = document.getElementById("studio-search-input");
const studioSearchClear = document.getElementById("studio-search-clear");
studioSearchInput?.addEventListener("input", (e) => {
  const value = e.target.value;
  if (studioSearchClear) studioSearchClear.hidden = !value;
  setStudioSearch(value);
});
studioSearchClear?.addEventListener("click", () => {
  if (!studioSearchInput) return;
  studioSearchInput.value = "";
  studioSearchClear.hidden = true;
  setStudioSearch("");
  studioSearchInput.focus();
});

// Suggest studios that appear in the schedule but aren't tracked yet.
function suggestStudios(query) {
  const q = normalizeStudioName(query);
  if (!q || q.length < 2) return [];
  const saved = new Set();
  for (const s of Studios.all()) {
    saved.add(normalizeStudioName(s.name));
    for (const a of s.aliases || []) saved.add(normalizeStudioName(a));
  }
  const hits = [];
  for (const entry of studioDisplayList) {
    if (saved.has(entry.key)) continue;
    if (entry.key.includes(q)) hits.push(entry);
    if (hits.length >= 8) break;
  }
  return hits;
}

function openStudioDialog(id) {
  const dlg = document.getElementById("studio-dialog");
  const form = document.getElementById("studio-form");
  const titleEl = document.getElementById("studio-title");
  const nameInput = document.getElementById("studio-name");
  const notesInput = document.getElementById("studio-notes");
  const cancel = document.getElementById("studio-cancel");
  const remove = document.getElementById("studio-remove");
  const suggList = document.getElementById("studio-suggestions");
  if (!dlg || !form) return;

  const existing = id ? Studios.all().find((s) => s.id === id) : null;
  titleEl.textContent = existing ? "Edit studio" : "Add studio";
  nameInput.value = existing?.name || "";
  notesInput.value = existing?.notes || "";
  remove.hidden = !existing;
  if (suggList) {
    suggList.innerHTML = "";
    suggList.hidden = true;
  }

  dlg.showModal();
  requestAnimationFrame(() => nameInput.focus());

  const paintSuggestions = (items) => {
    if (!suggList) return;
    suggList.innerHTML = "";
    if (!items.length) { suggList.hidden = true; return; }
    for (const h of items) {
      const li = el("li", {
          class: "director-suggestion",
          dataset: { name: h.name },
        },
        el("span", { class: "director-suggestion__name", text: h.name }),
        h.count ? el("span", { class: "director-suggestion__count", text: `${h.count} on schedule` }) : null,
      );
      suggList.appendChild(li);
    }
    suggList.hidden = false;
  };

  const renderSuggestions = () => {
    if (!suggList) return;
    if (existing) { suggList.hidden = true; return; }
    paintSuggestions(suggestStudios(nameInput.value));
  };

  let inputDebounce = null;
  const onInput = () => {
    clearTimeout(inputDebounce);
    inputDebounce = setTimeout(renderSuggestions, 200);
  };
  const onSuggestClick = (e) => {
    const li = e.target.closest(".director-suggestion");
    if (!li) return;
    e.preventDefault();
    nameInput.value = li.dataset.name || "";
    if (suggList) suggList.hidden = true;
    notesInput.focus();
  };

  const cleanup = () => {
    cancel.removeEventListener("click", onCancel);
    remove.removeEventListener("click", onRemove);
    form.removeEventListener("submit", onSubmit);
    dlg.removeEventListener("cancel", onEsc);
    nameInput.removeEventListener("input", onInput);
    suggList?.removeEventListener("mousedown", onSuggestClick);
    clearTimeout(inputDebounce);
  };
  const onCancel = () => { dlg.close(); cleanup(); };
  const onEsc = (e) => { e.preventDefault(); onCancel(); };
  const onRemove = () => {
    if (existing) Studios.remove(existing.id);
    dlg.close();
    cleanup();
  };
  const onSubmit = (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    const notes = notesInput.value.trim();
    if (existing) Studios.update(existing.id, { name, notes });
    else Studios.add(name, notes);
    dlg.close();
    cleanup();
  };

  cancel.addEventListener("click", onCancel);
  remove.addEventListener("click", onRemove);
  form.addEventListener("submit", onSubmit);
  dlg.addEventListener("cancel", onEsc);
  nameInput.addEventListener("input", onInput);
  suggList?.addEventListener("mousedown", onSuggestClick);
}

Studios.onChange(() => {
  if (activeTab === "studios") renderStudiosTab();
  else tabDirty.studios = true;
});

// ---------- Tabs ----------

let allBundles = [];
let activeTab = "list";
let updatesOpen = false;

// Track which tabs have been rendered at least once and which need a fresh
// render before being shown. Switching to a tab whose DOM is up-to-date just
// flips its `hidden` flag — no rebuild — so navigation feels instant.
const tabRendered = { list: false, calendar: false, interests: false, directors: false, studios: false };
const tabDirty = { list: true, calendar: true, interests: true, directors: true, studios: true };

const markAllTabsDirty = () => {
  tabDirty.list = true;
  tabDirty.calendar = true;
  tabDirty.interests = true;
  tabDirty.directors = true;
  tabDirty.studios = true;
};

const markOtherTabsDirty = () => {
  for (const t of ["list", "calendar", "interests", "directors", "studios"]) {
    if (t !== activeTab) tabDirty[t] = true;
  }
};

const setPanelHidden = (id, hide) => {
  const e = document.getElementById(id);
  if (e) e.hidden = hide;
};

function renderListTab() {
  const list = document.getElementById("list");
  const rep = document.getElementById("repertory-list");
  const theaterBar = document.getElementById("theater-filter-bar");
  if (activeKind === "releases") {
    setPanelHidden("repertory-list", true);
    setPanelHidden("theater-filter-bar", true);
    setPanelHidden("empty-repertory", true);
    if (rep) rep.innerHTML = "";
    if (list) list.hidden = false;
    renderYearTab(allBundles);
  } else {
    setPanelHidden("list", true);
    setPanelHidden("empty-year", true);
    if (list) list.innerHTML = "";
    if (rep) rep.hidden = false;
    if (theaterBar) theaterBar.hidden = false;
    renderTheaterFilterBar();
    renderRepertoryTab();
  }
}

function renderActiveTab() {
  if (activeTab === "list") renderListTab();
  else if (activeTab === "calendar") renderCalendarTab(allBundles);
  else if (activeTab === "interests") renderInterestsTab(allBundles);
  else if (activeTab === "directors") renderDirectorsTab();
  else if (activeTab === "studios") renderStudiosTab();
  tabRendered[activeTab] = true;
  tabDirty[activeTab] = false;
}

function ensureActiveTabFresh() {
  if (!tabRendered[activeTab] || tabDirty[activeTab]) renderActiveTab();
}

function switchTab(tab) {
  const wasOverlay = updatesOpen;
  if (updatesOpen) closeUpdates({ silent: true });
  if (tab === activeTab) {
    if (wasOverlay) {
      setPanelHidden("tab-list", activeTab !== "list");
      setPanelHidden("tab-calendar", activeTab !== "calendar");
      setPanelHidden("tab-interests", activeTab !== "interests");
      setPanelHidden("tab-directors", activeTab !== "directors");
      setPanelHidden("tab-studios", activeTab !== "studios");
    }
    return;
  }
  activeTab = tab;
  document.querySelectorAll(".tab-bar__btn").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.tab === tab)
  );
  // Reveal the destination panel immediately so the user sees the navigation
  // land on this frame; only rebuild its DOM if the cached copy is stale.
  setPanelHidden("tab-list", tab !== "list");
  setPanelHidden("tab-calendar", tab !== "calendar");
  setPanelHidden("tab-interests", tab !== "interests");
  setPanelHidden("tab-directors", tab !== "directors");
  setPanelHidden("tab-studios", tab !== "studios");
  syncSegmentedChips();

  ensureActiveTabFresh();
}

document.querySelectorAll(".tab-bar__btn").forEach((b) => {
  b.addEventListener("click", () => switchTab(b.dataset.tab));
});

document.getElementById("open-pat").addEventListener("click", () => {
  requestPat();
});

// Manual "Pull latest releases" button in the Updates panel. Kicks the
// refresh-data.yml workflow in the public repo via workflow_dispatch, using
// the same stored PAT as interest syncing. The token needs Actions write
// access on jackdengler/upcoming-movies for this to succeed.
const PULL_WORKFLOW_URL =
  "https://api.github.com/repos/jackdengler/upcoming-movies/actions/workflows/refresh-data.yml/dispatches";

async function triggerManualPull() {
  const btn = document.getElementById("pull-releases");
  const status = document.getElementById("pull-status");
  if (!btn) return;

  const setStatus = (msg, kind) => {
    if (!status) return;
    if (!msg) { status.hidden = true; status.textContent = ""; delete status.dataset.kind; return; }
    status.hidden = false;
    status.textContent = msg;
    status.dataset.kind = kind || "";
  };

  if (!Interests.hasPat()) {
    const saved = await requestPat();
    if (!saved || !Interests.hasPat()) return;
  }

  btn.disabled = true;
  setStatus("Requesting refresh…", "pending");
  try {
    const r = await fetch(PULL_WORKFLOW_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Interests.getPat()}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (r.status === 204) {
      setStatus("Refresh started. New releases should appear within a few minutes.", "ok");
    } else if (r.status === 401 || r.status === 403) {
      setStatus("Token can't start a refresh — it needs Actions write access.", "error");
    } else if (r.status === 404) {
      setStatus("Couldn't reach the refresh workflow. Check the token's repo access.", "error");
    } else {
      setStatus(`Refresh request failed (${r.status}). Try again later.`, "error");
    }
  } catch {
    setStatus("Network error. Try again when you're back online.", "error");
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("pull-releases").addEventListener("click", triggerManualPull);

function openUpdates() {
  updatesOpen = true;
  setPanelHidden("tab-list", true);
  setPanelHidden("tab-calendar", true);
  setPanelHidden("tab-interests", true);
  setPanelHidden("tab-directors", true);
  setPanelHidden("tab-studios", true);
  setPanelHidden("tab-updates", false);
  renderActivityTab();
  renderCodeVersionFooter();
  Activity.markSeen();
  updateActivityBadge();
}

// "App last updated …" line in the Updates panel. Skips bot commits to
// data/ — the only commit messages we treat as data-only are the two
// our automation produces: "Update interests" (PAT writes from the app)
// and "Refresh release data" (refresh-data.yml). Everything else counts
// as an actual code change.
//
// Fetched fresh every time the Updates panel opens (no cache) so a new
// deploy is reflected immediately. Falls back to the previous result on
// a transient network error so the line doesn't disappear.
const CODE_VERSION_KEY = "upcoming:code-version";

async function fetchLatestCodeCommit() {
  let commits;
  try {
    const r = await fetch(
      "https://api.github.com/repos/jackdengler/upcoming-movies/commits?per_page=30",
      { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" },
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    commits = await r.json();
  } catch {
    try {
      const raw = localStorage.getItem(CODE_VERSION_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  }
  if (!Array.isArray(commits)) return null;

  const isDataOnly = (c) => {
    const msg = String(c?.commit?.message || "").trim().toLowerCase();
    return msg.startsWith("update interests") || msg.startsWith("refresh release data");
  };
  const codeCommit = commits.find((c) => !isDataOnly(c));
  if (!codeCommit) return null;

  const result = {
    sha: codeCommit.sha,
    date: codeCommit.commit?.committer?.date || codeCommit.commit?.author?.date || null,
    message: String(codeCommit.commit?.message || "").split("\n")[0],
    url: codeCommit.html_url || null,
  };
  try { localStorage.setItem(CODE_VERSION_KEY, JSON.stringify(result)); } catch {}
  return result;
}

function formatCommitDate(iso) {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(then);
}

function paintCodeVersion(el, info, { prefix }) {
  if (!el) return;
  if (!info?.date) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = "";
  if (prefix) el.append(prefix);
  if (info.url) {
    const a = document.createElement("a");
    a.href = info.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = formatCommitDate(info.date);
    if (info.message) a.title = info.message;
    el.append(a);
  } else {
    el.append(formatCommitDate(info.date));
  }
}

async function renderCodeVersion() {
  const info = await fetchLatestCodeCommit();
  paintCodeVersion(document.getElementById("code-updated"), info, {
    prefix: "App last updated ",
  });
  paintCodeVersion(document.getElementById("header-updated"), info, {
    prefix: "Updated ",
  });
}

const renderCodeVersionFooter = renderCodeVersion;

function closeUpdates({ silent = false } = {}) {
  updatesOpen = false;
  setPanelHidden("tab-updates", true);
  if (silent) return;
  setPanelHidden("tab-list", activeTab !== "list");
  setPanelHidden("tab-calendar", activeTab !== "calendar");
  setPanelHidden("tab-interests", activeTab !== "interests");
  setPanelHidden("tab-directors", activeTab !== "directors");
  setPanelHidden("tab-studios", activeTab !== "studios");
}

document.getElementById("open-updates")?.addEventListener("click", openUpdates);
document.getElementById("updates-back")?.addEventListener("click", () => closeUpdates());

function syncSegmentedChips() {
  // Directors and Studios have nothing to do with release type or scope —
  // hide the entire header filter chrome on those tabs. (Decision 10: chrome
  // earned.)
  const onDirectors = activeTab === "directors" || activeTab === "studios";
  const bar = document.getElementById("kind-segmented");
  if (bar) {
    bar.hidden = onDirectors;
    for (const chip of bar.querySelectorAll(".segmented__btn")) {
      const on = chip.dataset.kind === activeKind;
      chip.classList.toggle("is-active", on);
      chip.setAttribute("aria-selected", on ? "true" : "false");
    }
  }
  const scope = document.getElementById("scope-segmented");
  if (scope) {
    scope.hidden = onDirectors || activeKind !== "releases";
    for (const chip of scope.querySelectorAll(".segmented__btn")) {
      const on = chip.dataset.scope === activeScope;
      chip.classList.toggle("is-active", on);
      chip.setAttribute("aria-selected", on ? "true" : "false");
    }
  }
  const amcWrap = document.getElementById("amc-local-toggle-wrap");
  const amcBtn = document.getElementById("amc-local-toggle");
  if (amcWrap) amcWrap.hidden = onDirectors || activeKind !== "releases";
  if (amcBtn) amcBtn.setAttribute("aria-pressed", amcLocalOnly ? "true" : "false");
  const skipWrap = document.getElementById("hide-skipped-toggle-wrap");
  const skipBtn = document.getElementById("hide-skipped-toggle");
  if (skipWrap) skipWrap.hidden = onDirectors || activeKind !== "releases";
  if (skipBtn) skipBtn.setAttribute("aria-pressed", hideSkipped ? "true" : "false");
}

document.getElementById("kind-segmented")?.addEventListener("click", (e) => {
  const chip = e.target.closest(".segmented__btn");
  if (!chip) return;
  const kind = chip.dataset.kind;
  if (kind !== "releases" && kind !== "rereleases") return;
  if (kind === activeKind) return;
  activeKind = kind;
  saveActiveKind();
  syncSegmentedChips();
  // The kind affects every list/calendar/interests panel, so mark all stale.
  markAllTabsDirty();
  if (updatesOpen) renderActivityTab();
  else renderActiveTab();
});

document.getElementById("amc-local-toggle")?.addEventListener("click", () => {
  amcLocalOnly = !amcLocalOnly;
  saveAmcLocalOnly();
  syncSegmentedChips();
  // Same blast radius as the scope chips: List + Calendar use it,
  // Interests/Updates ignore it.
  tabDirty.list = true;
  tabDirty.calendar = true;
  if (!updatesOpen) renderActiveTab();
});

document.getElementById("hide-skipped-toggle")?.addEventListener("click", () => {
  hideSkipped = !hideSkipped;
  saveHideSkipped();
  syncSegmentedChips();
  tabDirty.list = true;
  tabDirty.calendar = true;
  if (!updatesOpen) renderActiveTab();
});

document.getElementById("scope-segmented")?.addEventListener("click", (e) => {
  const chip = e.target.closest(".segmented__btn");
  if (!chip) return;
  const scope = chip.dataset.scope;
  if (scope !== "both" && scope !== "wide" && scope !== "limited") return;
  if (scope === activeScope) return;
  activeScope = scope;
  saveActiveScope();
  syncSegmentedChips();
  // Scope only affects List + Calendar; Interests/Updates are unfiltered.
  tabDirty.list = true;
  tabDirty.calendar = true;
  if (!updatesOpen) renderActiveTab();
});
syncSegmentedChips();

// ---------- Search input ----------

const searchInput = document.getElementById("search-input");
const searchClearBtn = document.getElementById("search-clear");
const searchBarEl = document.getElementById("search-bar");
const searchToggleBtn = document.getElementById("open-search");

let searchTimer = null;
function applySearch(value) {
  const next = normalizeQuery(value);
  if (next === searchQuery) return;
  searchQuery = next;
  if (searchClearBtn) searchClearBtn.hidden = !value;
  // Search only impacts the List tab; mark Calendar dirty too in case the
  // user toggles back later. Interests/Updates ignore the search.
  tabDirty.list = true;
  if (activeTab === "list" && !updatesOpen) renderListTab();
}

// Header search icon toggles the inline search bar. Hidden by default so
// the chrome reads as 4 controls (search/bell/settings + segmented) rather
// than 5; revealing the bar is a deliberate gesture.
function setSearchBarOpen(open) {
  if (!searchBarEl || !searchInput) return;
  searchBarEl.hidden = !open;
  if (searchToggleBtn) {
    searchToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    searchToggleBtn.classList.toggle("is-active", !!open);
  }
  if (open) {
    // Defer focus to the next frame so iOS Safari attaches the keyboard
    // after the row paints — focusing during the same task occasionally
    // drops the IME on the floor.
    requestAnimationFrame(() => searchInput.focus());
  } else {
    if (searchInput.value) {
      searchInput.value = "";
      clearTimeout(searchTimer);
      applySearch("");
    }
  }
}

searchToggleBtn?.addEventListener("click", () => {
  setSearchBarOpen(searchBarEl?.hidden !== false);
});

searchInput?.addEventListener("input", (e) => {
  const value = e.target.value;
  if (searchClearBtn) searchClearBtn.hidden = !value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => applySearch(value), 120);
});
searchInput?.addEventListener("search", (e) => {
  clearTimeout(searchTimer);
  applySearch(e.target.value);
});
searchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    setSearchBarOpen(false);
  }
});
searchClearBtn?.addEventListener("click", () => {
  if (!searchInput) return;
  searchInput.value = "";
  clearTimeout(searchTimer);
  applySearch("");
  searchInput.focus();
});

document.getElementById("cal-prev")?.addEventListener("click", () => shiftCalendar(-1));
document.getElementById("cal-next")?.addEventListener("click", () => shiftCalendar(1));
document.getElementById("cal-grid")?.addEventListener("click", (e) => {
  const cell = e.target.closest(".calendar__cell");
  if (!cell) return;
  const iso = cell.dataset.date;
  if (!iso) return;
  if (cell.dataset.inMonth === "false") {
    const [y, m] = iso.split("-").map(Number);
    calState.year = y;
    calState.monthIdx = m - 1;
  }
  calState.selected = iso;
  renderCalendarTab(allBundles);
});

// ---------- PAT dialog ----------

function requestPat() {
  return new Promise((resolve) => {
    const dlg = document.getElementById("pat-dialog");
    const input = document.getElementById("pat-input");
    const cancel = document.getElementById("pat-cancel");
    const form = document.getElementById("pat-form");

    input.value = Interests.getPat() || "";
    dlg.showModal();

    const onCancel = () => { dlg.close(); cleanup(); resolve(false); };
    const onSubmit = async (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      Interests.setPat(v);
      // Pull remote state with the new token before we let the caller
      // mutate marks. Without this, a fresh-install + new-PAT scenario
      // could commit an empty marks object over a populated remote.
      try { await Promise.all([Interests.load(), Directors.load(), Studios.load()]); } catch {}
      dlg.close();
      cleanup();
      resolve(true);
    };
    function cleanup() {
      cancel.removeEventListener("click", onCancel);
      form.removeEventListener("submit", onSubmit);
    }
    cancel.addEventListener("click", onCancel);
    form.addEventListener("submit", onSubmit);
  });
}

// ---------- Booking dialog ----------

function requestDateDialog({ heading, copy, defaultDate, isUpdate }) {
  return new Promise((resolve) => {
    const dlg = document.getElementById("book-dialog");
    const input = document.getElementById("book-input");
    const titleEl = document.getElementById("book-title");
    const copyEl = document.getElementById("book-copy");
    const cancel = document.getElementById("book-cancel");
    const remove = document.getElementById("book-remove");
    const form = document.getElementById("book-form");

    input.value = defaultDate || TODAY;
    titleEl.textContent = heading || "Pick a date";
    copyEl.textContent = copy || "Pick a date.";
    remove.hidden = !isUpdate;
    dlg.showModal();

    const cleanup = () => {
      cancel.removeEventListener("click", onCancel);
      remove.removeEventListener("click", onRemove);
      form.removeEventListener("submit", onSubmit);
      dlg.removeEventListener("cancel", onEsc);
    };
    const onCancel = () => { dlg.close(); cleanup(); resolve({ action: "cancel" }); };
    const onEsc = (e) => { e.preventDefault(); onCancel(); };
    const onRemove = () => { dlg.close(); cleanup(); resolve({ action: "remove" }); };
    const onSubmit = (e) => {
      e.preventDefault();
      const v = input.value;
      if (!v) return;
      dlg.close();
      cleanup();
      resolve({ action: "save", date: v });
    };
    cancel.addEventListener("click", onCancel);
    remove.addEventListener("click", onRemove);
    form.addEventListener("submit", onSubmit);
    dlg.addEventListener("cancel", onEsc);
  });
}

// ---------- Showtime picker dialog ----------

// Present the user with a list of showings for a rereleases run and resolve
// with the chosen one. `showings` is an array of { date, time, theater }.
// Returns { action: "save", showing } | { action: "remove" } | { action: "cancel" }.
function requestShowtimeDialog({ heading, copy, showings, isUpdate, selectedKey }) {
  return new Promise((resolve) => {
    const dlg = document.getElementById("showtime-dialog");
    const titleEl = document.getElementById("showtime-title");
    const copyEl = document.getElementById("showtime-copy");
    const listEl = document.getElementById("showtime-list");
    const cancel = document.getElementById("showtime-cancel");
    const remove = document.getElementById("showtime-remove");

    titleEl.textContent = heading || "Pick a showtime";
    copyEl.textContent = copy || "Tap the showtime.";
    remove.hidden = !isUpdate;
    listEl.innerHTML = "";

    const buttons = [];
    if (!showings.length) {
      listEl.appendChild(el("p", { class: "sheet__copy", text: "No showtimes available." }));
    } else {
      for (const s of showings) {
        const key = `${s.date}|${s.time}|${s.theater}`;
        const btn = el("button", {
            type: "button",
            class: `showtime-option${key === selectedKey ? " is-selected" : ""}`,
            dataset: { key },
          },
          el("span", { class: "showtime-option__when", text: `${fmtDateShort(s.date)} · ${fmtTime(s.time)}` }),
          el("span", { class: "showtime-option__where", text: shortTheaterName(s.theater) }),
        );
        btn.addEventListener("click", () => {
          dlg.close();
          cleanup();
          resolve({ action: "save", showing: s });
        });
        buttons.push(btn);
        listEl.appendChild(btn);
      }
    }

    dlg.showModal();

    const cleanup = () => {
      cancel.removeEventListener("click", onCancel);
      remove.removeEventListener("click", onRemove);
      dlg.removeEventListener("cancel", onEsc);
    };
    const onCancel = () => { dlg.close(); cleanup(); resolve({ action: "cancel" }); };
    const onEsc = (e) => { e.preventDefault(); onCancel(); };
    const onRemove = () => { dlg.close(); cleanup(); resolve({ action: "remove" }); };
    cancel.addEventListener("click", onCancel);
    remove.addEventListener("click", onRemove);
    dlg.addEventListener("cancel", onEsc);
  });
}

// ---------- Boot ----------

// Run a render pass scheduled by `Interests.onChange`. Multiple synchronous
// interest mutations collapse into one rAF tick: we either rebuild the active
// tab once (interests / calendar / rereleases list) or, on the new-releases
// list, do a cheap in-place class/badge update on the rows that exist.
let pendingInterestsRender = false;
function flushInterestsChange() {
  pendingInterestsRender = false;

  // The active tab gets a real re-render; the others get a dirty flag so they
  // rebuild on the next visit instead of right now.
  let didFullRender = false;
  if (activeTab === "interests") {
    renderInterestsTab(allBundles);
    didFullRender = true;
  } else if (activeTab === "calendar") {
    renderCalendarTab(allBundles);
    didFullRender = true;
  } else if (activeTab === "list" && activeKind === "rereleases") {
    renderRepertoryTab();
    didFullRender = true;
  } else if (activeTab === "studios") {
    renderStudiosTab();
    didFullRender = true;
  }
  if (didFullRender) {
    tabRendered[activeTab] = true;
    tabDirty[activeTab] = false;
    markOtherTabsDirty();
    return;
  }
  // We're on the new-releases list, which we don't fully rebuild on every
  // interest tap. Instead, patch the existing rows in place and let the other
  // tabs lazily rebuild when revealed.
  markOtherTabsDirty();

  for (const row of document.querySelectorAll(".row[data-key]")) {
    const key = row.dataset.key;
    const lvl = Interests.getLevel(key);
    const mark = Interests.getMark(key);
    row.classList.remove("row--watched", "row--booked", "row--must", "row--likely", "row--potential", "row--not");
    if (lvl) row.classList.add(`row--${lvl}`);

    const existingBooked = row.querySelector(".row__booked");
    if (lvl === "booked" && mark?.booked_date) {
      const text = `🎟  Booked for ${fmtDateShort(mark.booked_date)}`;
      if (existingBooked) {
        existingBooked.textContent = text;
      } else {
        const badge = el("div", { class: "row__booked", text });
        const metaEl = row.querySelector(".row__meta");
        const after = metaEl || row.querySelector(".row__title-line");
        after?.after(badge);
      }
    } else if (existingBooked) {
      existingBooked.remove();
    }

    const existingWatched = row.querySelector(".row__watched");
    if (lvl === "watched" && mark?.watched_date) {
      const text = `✓  Watched ${fmtDateShort(mark.watched_date)}`;
      if (existingWatched) {
        existingWatched.textContent = text;
      } else {
        const badge = el("div", { class: "row__watched", text });
        const anchor = row.querySelector(".row__booked")
          || row.querySelector(".row__meta")
          || row.querySelector(".row__title-line");
        anchor?.after(badge);
      }
    } else if (existingWatched) {
      existingWatched.remove();
    }
  }
  for (const btn of document.querySelectorAll(".rating__btn")) {
    const row = btn.closest(".row");
    if (!row) continue;
    const lvl = Interests.getLevel(row.dataset.key);
    const isActive = btn.dataset.level === lvl;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
}

Interests.onChange(() => {
  if (pendingInterestsRender) return;
  pendingInterestsRender = true;
  requestAnimationFrame(flushInterestsChange);
});

Promise.all([loadYear(YEAR), loadRepertory(), Interests.load(), Directors.load(), Studios.load()])
  .then(([bundles, repertory]) => {
    allBundles = bundles;
    buildDirectorIndex(bundles);
    buildStudioIndex(bundles);
    setRepertoryData(repertory);
    Interests.sweepPastBookings(TODAY);
    Activity.ingest({ bundles, screenings: repertory?.screenings || [] });
    updateActivityBadge();
    renderActiveTab();
    renderCodeVersion();
  })
  .catch((e) => {
    const empty = document.getElementById("empty-year");
    empty.textContent = `Couldn't load data (${e?.message || "network error"}). Kill & reopen the app.`;
    empty.hidden = false;
  });
