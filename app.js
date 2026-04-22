import * as Interests from "./js/interests.js";
import * as Activity from "./js/activity.js";

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

// Rereleases interest is stored at the (theater, title, month) granularity:
// marking "Training Day at New Beverly, April" once applies to every showtime
// of that run. Three states: "yes" (interested), "no" (skip), or absent (not
// yet evaluated). The ID is independent from `screeningKey` (per-showtime) so
// the two models don't collide.
const repTitleMonthId = (s) =>
  `${s.theater}|${slugifyClient(s.title)}|${(s.date || "").slice(0, 7)}`;

const REP_MARKS_KEY = "upcoming:rereleases-marks";
const REP_MARKS_KEY_LEGACY = "upcoming:rereleases-interest"; // superseded
const repMarks = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(REP_MARKS_KEY) || "null");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) return saved;
  } catch {}
  // One-time migration: legacy key stored a Set of interested IDs only.
  try {
    const legacy = JSON.parse(localStorage.getItem(REP_MARKS_KEY_LEGACY) || "null");
    if (Array.isArray(legacy)) {
      const out = Object.fromEntries(legacy.map((id) => [id, "yes"]));
      try { localStorage.setItem(REP_MARKS_KEY, JSON.stringify(out)); } catch {}
      return out;
    }
  } catch {}
  return {};
})();
const saveRepMarks = () => {
  try { localStorage.setItem(REP_MARKS_KEY, JSON.stringify(repMarks)); } catch {}
};
const getRepMark = (id) => repMarks[id] || null;
const setRepMark = (id, value) => {
  if (value) repMarks[id] = value;
  else delete repMarks[id];
  saveRepMarks();
};

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
    urls.map((u) => fetch(u, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null))
  );
  return results.filter(Boolean);
}

async function loadRepertory() {
  try {
    const r = await fetch("./data/repertory.json", { cache: "no-cache" });
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

function renderRatingBar(m) {
  const isScreening = m._kind === "screening";
  const key = itemKey(m);
  const level = Interests.getLevel(key);
  const mark = Interests.getMark(key);
  const noLocal = !!mark?.no_local_theater;
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

  const notLocalBtn = isScreening
    ? null
    : el("button", {
        type: "button",
        class: `row__flag row__flag--no-local${noLocal ? " is-active" : ""}`,
        "data-flag": "no_local_theater",
        "aria-pressed": noLocal ? "true" : "false",
      },
      "📍  Not playing near me",
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

  if (notLocalBtn) {
    notLocalBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!Interests.hasPat()) {
        const saved = await requestPat();
        if (!saved) return;
      }
      const current = !!Interests.getMark(key)?.no_local_theater;
      Interests.setFlag(key, "no_local_theater", !current, baseMeta(m));
    });
  }

  return [bar, notLocalBtn].filter(Boolean);
}

function renderRow(m, opts = {}) {
  const key = movieKey(m);
  const level = Interests.getLevel(key);
  const mark = Interests.getMark(key);

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

  const bookedBadge = level === "booked" && mark?.booked_date
    ? el("div", { class: "row__booked", text: `🎟  Booked for ${fmtDateShort(mark.booked_date)}` })
    : null;
  const watchedBadge = level === "watched" && mark?.watched_date
    ? el("div", { class: "row__watched", text: `✓  Watched ${fmtDateShort(mark.watched_date)}` })
    : null;
  const noLocalBadge = mark?.no_local_theater
    ? el("div", { class: "row__nolocal", text: "📍  Not playing near me" })
    : null;

  return el("div", {
      class: `row${level ? ` row--${level}` : ""}${mark?.no_local_theater ? " row--no-local" : ""}`,
      dataset: { key },
    },
    el("div", { class: "row__title-line" },
      el("h3", { class: "row__title" }, titleLink),
      el("span", { class: chipClass(m.release_type), text: chipLabel(m.release_type) }),
    ),
    meta ? el("div", { class: "row__meta", text: meta }) : null,
    bookedBadge,
    watchedBadge,
    noLocalBadge,
    el("dl", { class: "row__sub" },
      el("dt", { text: "Director" }), el("dd", { text: m.director }),
      el("dt", { text: "Studio" }), el("dd", { text: m.studio }),
      el("dt", { text: "Budget" }), el("dd", { text: fmtBudget(m.budget_usd, m.budget_note) }),
      m.cast && m.cast !== "—" ? el("dt", { text: "Cast" }) : null,
      m.cast && m.cast !== "—" ? el("dd", { text: m.cast }) : null,
    ),
    m.notes ? el("p", { class: "row__notes", text: m.notes }) : null,
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
      el("span", { class: "chip--theater", text: theaterName }),
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
  const filtered = bundle.releases;
  if (!filtered.length) return null;

  const defaultOpen = key === CURRENT_MONTH_KEY || key === NEXT_MONTH_KEY;
  const open = key in expanded ? expanded[key] : defaultOpen;
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

    if (key.startsWith("rep:") || meta.kind === "screening") {
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
  if (!total) { empty.hidden = false; return; }
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
        el("span", { class: "month__chevron", "aria-hidden": "true" }),
        el("span", { class: "month__name", text: titles[lv] }),
        el("span", { class: "month__count", text: `${items.length}` }),
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
    empty.textContent = "No releases match current filters.";
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
        if (!map.has(m.date)) map.set(m.date, []);
        map.get(m.date).push(m);
      }
    }
  } else {
    for (const s of repertoryState.data?.screenings || []) {
      if (getRepMark(repTitleMonthId(s)) !== "yes") continue;
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
  const bookedMap = marksByField("booked", "booked_date");
  const watchedMap = marksByField("watched", "watched_date");

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

const repertoryState = {
  data: null,                         // { theaters, screenings, ... } or null
  theatersBySlug: new Map(),
  hiddenTheaters: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(THEATER_FILTER_KEY) || "null");
      if (saved && typeof saved === "object") return new Set(saved);
    } catch {}
    return new Set();
  })(),
};

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

  for (const t of theaters) {
    const active = !repertoryState.hiddenTheaters.has(t.slug);
    const btn = el("button", {
        type: "button",
        class: `theater-chip${active ? " is-active" : ""}`,
        dataset: { slug: t.slug },
      },
      t.name.replace(/^AMC /, "").replace(/^The /, ""),
    );
    bar.appendChild(btn);
  }

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".theater-chip");
    if (!btn) return;
    const slug = btn.dataset.slug;
    if (!slug) return;
    if (repertoryState.hiddenTheaters.has(slug)) {
      repertoryState.hiddenTheaters.delete(slug);
    } else {
      repertoryState.hiddenTheaters.add(slug);
    }
    saveTheaterFilters();
    renderTheaterFilterBar();
    renderRepertoryTab();
  }, { once: true });
}

// Collapse a flat screening list into { monthKey -> { titleMonthId -> entry } }.
// Each entry represents one film's run at one theater in one calendar month,
// carrying every showtime in that run.
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
        theater: s.theater,
        title: s.title,
        year: s.year || null,
        // Format / series are usually consistent across showtimes but can
        // vary (e.g. one midnight show in a run). Carry the first non-null
        // and track any others for display.
        format: s.format || null,
        series: s.series || null,
        url: s.url || null,
        showings: [],
      };
      monthGroup.set(id, entry);
    }
    if (!entry.format && s.format) entry.format = s.format;
    if (!entry.series && s.series) entry.series = s.series;
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

const fmtMonthLabel = (yyyymm) => {
  const [y, m] = yyyymm.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yyyymm;
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

function renderRepTitleRow(entry) {
  const theaterMeta = repertoryState.theatersBySlug.get(entry.theater);
  const theaterName = theaterMeta?.name || entry.theater;
  const linkUrl = entry.url || theaterMeta?.url || wikipediaUrl(entry.title, `${entry.year || ""}-01-01`);

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

  const countText = `${entry.showings.length} showing${entry.showings.length === 1 ? "" : "s"}`;

  const mark = getRepMark(entry.id);
  const mkMarkBtn = (value, label) => el("button", {
      type: "button",
      class: `rep-interest rep-interest--${value}${mark === value ? " is-on" : ""}`,
      "aria-pressed": mark === value ? "true" : "false",
      dataset: { id: entry.id, mark: value },
    },
    label,
  );
  const markButtons = el("div", { class: "rep-interest-group" },
    mkMarkBtn("yes", "Interested"),
    mkMarkBtn("no", "Not interested"),
  );

  const summary = el("summary", { class: "rep-title__summary" },
    el("div", { class: "rep-title__head" },
      el("div", { class: "row__title-line" },
        titleNode,
        el("span", { class: "chip--theater", text: theaterName }),
      ),
      markButtons,
    ),
    el("div", { class: "rep-title__meta" },
      el("span", { class: "row__meta", text: countText }),
      entry.series ? el("span", { class: "row__meta", text: ` · ${entry.series}` }) : null,
    ),
  );

  const body = el("div", { class: "rep-title__body" },
    ...entry.showings.map((s) => {
      const when = `${fmtDateShort(s.date)} · ${fmtTime(s.time)}`;
      return el("div", { class: "rep-title__showing" },
        s.url
          ? el("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", text: when })
          : el("span", { text: when }),
      );
    }),
  );

  const modClass = mark === "yes" ? " rep-title--on" : mark === "no" ? " rep-title--off" : "";
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

  const groups = groupByTitleMonth(screenings);
  for (const [monthKey, titleMap] of groups) {
    const entries = [...titleMap.values()].sort(
      (a, b) =>
        (a.title || "").localeCompare(b.title || "") ||
        (a.theater || "").localeCompare(b.theater || ""),
    );
    const section = el("section", { class: "section" },
      el("header", { class: "section__header" },
        el("span", { class: "section__date", text: fmtMonthLabel(monthKey) }),
        el("span", { class: "section__count", text: `${entries.length}` }),
      ),
      el("div", { class: "section__list" }, ...entries.map(renderRepTitleRow)),
    );
    list.appendChild(section);
  }
}

document.getElementById("repertory-list")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".rep-interest");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const id = btn.dataset.id;
  const want = btn.dataset.mark; // "yes" | "no"
  if (!id || !want) return;
  // Tapping the active mark clears it; tapping the other flips the state.
  setRepMark(id, getRepMark(id) === want ? null : want);
  renderRepertoryTab();
  if (activeTab === "calendar") renderCalendarTab(allBundles);
});

// ---------- Tabs ----------

let allBundles = [];
let activeTab = "list";
let updatesOpen = false;

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
}

function switchTab(tab) {
  const wasOverlay = updatesOpen;
  if (updatesOpen) closeUpdates({ silent: true });
  if (tab === activeTab) {
    if (wasOverlay) {
      setPanelHidden("tab-list", activeTab !== "list");
      setPanelHidden("tab-calendar", activeTab !== "calendar");
      setPanelHidden("tab-interests", activeTab !== "interests");
    }
    return;
  }
  activeTab = tab;
  document.querySelectorAll(".tab-bar__btn").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.tab === tab)
  );
  setPanelHidden("tab-list", tab !== "list");
  setPanelHidden("tab-calendar", tab !== "calendar");
  setPanelHidden("tab-interests", tab !== "interests");

  renderActiveTab();
}

document.querySelectorAll(".tab-bar__btn").forEach((b) => {
  b.addEventListener("click", () => switchTab(b.dataset.tab));
});

document.getElementById("open-pat").addEventListener("click", () => {
  requestPat();
});

function openUpdates() {
  updatesOpen = true;
  setPanelHidden("tab-list", true);
  setPanelHidden("tab-calendar", true);
  setPanelHidden("tab-interests", true);
  setPanelHidden("tab-updates", false);
  renderActivityTab();
  Activity.markSeen();
  updateActivityBadge();
}

function closeUpdates({ silent = false } = {}) {
  updatesOpen = false;
  setPanelHidden("tab-updates", true);
  if (silent) return;
  setPanelHidden("tab-list", activeTab !== "list");
  setPanelHidden("tab-calendar", activeTab !== "calendar");
  setPanelHidden("tab-interests", activeTab !== "interests");
}

document.getElementById("open-updates")?.addEventListener("click", openUpdates);
document.getElementById("updates-back")?.addEventListener("click", () => closeUpdates());

function syncSegmentedChips() {
  const bar = document.getElementById("kind-segmented");
  if (!bar) return;
  for (const chip of bar.querySelectorAll(".segmented__btn")) {
    const on = chip.dataset.kind === activeKind;
    chip.classList.toggle("is-active", on);
    chip.setAttribute("aria-selected", on ? "true" : "false");
  }
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
  if (updatesOpen) renderActivityTab();
  else renderActiveTab();
});
syncSegmentedChips();

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
    const onSubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      Interests.setPat(v);
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

// ---------- Boot ----------

Interests.onChange(() => {
  if (activeTab === "interests") renderInterestsTab(allBundles);
  else if (activeTab === "calendar") renderCalendarTab(allBundles);
  else if (activeTab === "list" && activeKind === "rereleases") renderRepertoryTab();
  for (const row of document.querySelectorAll(".row[data-key]")) {
    const key = row.dataset.key;
    const lvl = Interests.getLevel(key);
    const mark = Interests.getMark(key);
    row.classList.remove("row--watched", "row--booked", "row--must", "row--likely", "row--potential", "row--not");
    if (lvl) row.classList.add(`row--${lvl}`);
    row.classList.toggle("row--no-local", !!mark?.no_local_theater);

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

    const existingNoLocal = row.querySelector(".row__nolocal");
    if (mark?.no_local_theater) {
      if (!existingNoLocal) {
        const badge = el("div", { class: "row__nolocal", text: "📍  Not playing near me" });
        const anchor = row.querySelector(".row__watched")
          || row.querySelector(".row__booked")
          || row.querySelector(".row__meta")
          || row.querySelector(".row__title-line");
        anchor?.after(badge);
      }
    } else if (existingNoLocal) {
      existingNoLocal.remove();
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
  for (const btn of document.querySelectorAll(".row__flag--no-local")) {
    const row = btn.closest(".row");
    if (!row) continue;
    const noLocal = !!Interests.getMark(row.dataset.key)?.no_local_theater;
    btn.classList.toggle("is-active", noLocal);
    btn.setAttribute("aria-pressed", noLocal ? "true" : "false");
  }
});

Promise.all([loadYear(YEAR), loadRepertory(), Interests.load()])
  .then(([bundles, repertory]) => {
    allBundles = bundles;
    setRepertoryData(repertory);
    Interests.sweepPastBookings(TODAY);
    Activity.ingest({ bundles, screenings: repertory?.screenings || [] });
    updateActivityBadge();
    renderActiveTab();
  })
  .catch((e) => {
    const empty = document.getElementById("empty-year");
    empty.textContent = `Couldn't load data (${e?.message || "network error"}). Kill & reopen the app.`;
    empty.hidden = false;
  });
