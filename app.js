import * as Interests from "./js/interests.js";

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
const TODAY = now.toISOString().slice(0, 10);
const CURRENT_MONTH_KEY = `${YEAR}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const NEXT_MONTH_KEY = (() => {
  const d = new Date(YEAR, now.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
})();

const LEVELS = ["must", "likely", "potential", "not", "watched"];
const LEVEL_LABEL = {
  must: "Must",
  likely: "Likely",
  potential: "Unlikely",
  not: "Skip",
  watched: "Seen",
};

const TYPES = ["wide", "limited", "streaming"];
const FILTER_KEY = "upcoming:filters";
const EXPANDED_KEY = "upcoming:expanded";
const filters = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_KEY) || "null");
    if (saved && typeof saved === "object") {
      return { wide: !!saved.wide, limited: !!saved.limited, streaming: !!saved.streaming };
    }
  } catch {}
  return { wide: true, limited: true, streaming: true };
})();
const saveFilters = () => {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch {}
};
const passesFilter = (m) => filters[m.release_type] !== false;

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

const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "open" && v) n.setAttribute("open", "");
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

// ---------- Row rendering ----------

function renderRatingBar(m) {
  const key = movieKey(m);
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
    Interests.set(key, current === lvl ? null : lvl, {
      title: m.title,
      date: m.date,
      tmdb_id: m.tmdb_id || null,
    });
  });

  return bar;
}

function renderRow(m) {
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

  return el("div", {
      class: `row${level ? ` row--${level}` : ""}`,
      dataset: { key },
    },
    el("div", { class: "row__title-line" },
      el("h3", { class: "row__title" }, titleLink),
      el("span", { class: chipClass(m.release_type), text: chipLabel(m.release_type) }),
    ),
    m.genre ? el("div", { class: "row__meta", text: m.genre }) : null,
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
  const filtered = bundle.releases.filter(passesFilter);
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

  const marks = Interests.allMarks();
  const grouped = { must: [], likely: [], potential: [], not: [], watched: [] };

  for (const [key, meta] of Object.entries(marks)) {
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
    if (!passesFilter(movie)) continue;
    if (grouped[meta.level]) grouped[meta.level].push(movie);
  }

  const order = ["must", "likely", "watched", "potential", "not"];
  const titles = {
    must: "Must watch",
    likely: "Likely watch",
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
    items.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    list.appendChild(
      el("details", {
          class: `month interest-group interest-group--${lv}`,
          open: true,
          dataset: { level: lv },
        },
        el("summary", { class: "month__summary" },
          el("span", { class: "month__chevron", "aria-hidden": "true" }),
          el("span", { class: "month__name", text: titles[lv] }),
          el("span", { class: "month__count", text: `${items.length}` }),
        ),
        el("div", { class: "month__body" },
          el("div", { class: "section" },
            el("div", { class: "section__list" }, ...items.map(renderRow)),
          )
        )
      )
    );
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

// ---------- Tabs ----------

let allBundles = [];
let activeTab = "year";

function switchTab(tab) {
  if (tab === activeTab) return;
  activeTab = tab;
  document.querySelectorAll(".tab-bar__btn").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.tab === tab)
  );
  document.getElementById("tab-year").hidden = tab !== "year";
  document.getElementById("tab-interests").hidden = tab !== "interests";

  const title = document.getElementById("view-title");
  const sub = document.getElementById("view-sub");
  if (tab === "year") { title.textContent = "Upcoming"; sub.textContent = `${YEAR}`; }
  else { title.textContent = "Interests"; sub.textContent = ""; }

  if (tab === "interests") renderInterestsTab(allBundles);
}

document.querySelectorAll(".tab-bar__btn").forEach((b) => {
  b.addEventListener("click", () => switchTab(b.dataset.tab));
});

document.getElementById("open-pat").addEventListener("click", () => {
  requestPat();
});

function syncFilterChips() {
  for (const chip of document.querySelectorAll(".filter-chip")) {
    chip.classList.toggle("is-active", filters[chip.dataset.type] !== false);
  }
}

document.querySelectorAll(".filter-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const t = chip.dataset.type;
    filters[t] = !filters[t];
    saveFilters();
    syncFilterChips();
    if (activeTab === "year") renderYearTab(allBundles);
    else renderInterestsTab(allBundles);
  });
});
syncFilterChips();

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

// ---------- Boot ----------

Interests.onChange(() => {
  if (activeTab === "interests") renderInterestsTab(allBundles);
  for (const row of document.querySelectorAll(".row[data-key]")) {
    const lvl = Interests.getLevel(row.dataset.key);
    row.classList.remove("row--must", "row--likely", "row--potential", "row--not", "row--watched");
    if (lvl) row.classList.add(`row--${lvl}`);
  }
  for (const btn of document.querySelectorAll(".rating__btn")) {
    const row = btn.closest(".row");
    if (!row) continue;
    const lvl = Interests.getLevel(row.dataset.key);
    const isActive = btn.dataset.level === lvl;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
});

Promise.all([loadYear(YEAR), Interests.load()])
  .then(([bundles]) => {
    allBundles = bundles;
    renderYearTab(bundles);
  })
  .catch((e) => {
    const empty = document.getElementById("empty-year");
    empty.textContent = `Couldn't load data (${e?.message || "network error"}). Kill & reopen the app.`;
    empty.hidden = false;
  });
