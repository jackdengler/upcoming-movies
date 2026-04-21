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

const LEVELS = ["must", "likely", "booked", "potential", "not", "watched"];
const LEVEL_LABEL = {
  must: "Must",
  likely: "Likely",
  booked: "Booked",
  potential: "Unlikely",
  not: "Skip",
  watched: "Seen",
};

const TYPES = ["wide", "limited", "streaming"];
const FILTER_KEY = "upcoming:filters";
const EXPANDED_KEY = "upcoming:expanded";
const INTEREST_EXPANDED_KEY = "upcoming:interest-expanded";
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

    if (lvl === "booked") {
      const existing = Interests.getMark(key);
      const result = await requestBookingDate({
        title: m.title,
        defaultDate: existing?.booked_date || m.date || TODAY,
        isUpdate: current === "booked",
      });
      if (result.action === "cancel") return;
      if (result.action === "remove") {
        Interests.set(key, null);
        return;
      }
      Interests.set(key, "booked", {
        title: m.title,
        date: m.date,
        tmdb_id: m.tmdb_id || null,
        booked_date: result.date,
      });
      return;
    }

    Interests.set(key, current === lvl ? null : lvl, {
      title: m.title,
      date: m.date,
      tmdb_id: m.tmdb_id || null,
    });
  });

  return bar;
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

  return el("div", {
      class: `row${level ? ` row--${level}` : ""}`,
      dataset: { key },
    },
    el("div", { class: "row__title-line" },
      el("h3", { class: "row__title" }, titleLink),
      el("span", { class: chipClass(m.release_type), text: chipLabel(m.release_type) }),
    ),
    meta ? el("div", { class: "row__meta", text: meta }) : null,
    bookedBadge,
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

  const marks = Interests.allMarks();
  const grouped = { must: [], likely: [], booked: [], potential: [], not: [], watched: [] };

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

  const order = ["booked", "must", "likely", "watched", "potential", "not"];
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
        const am = Interests.getMark(movieKey(a))?.booked_date || a.date || "";
        const bm = Interests.getMark(movieKey(b))?.booked_date || b.date || "";
        return am.localeCompare(bm);
      });
    } else {
      items.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    }

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
          el("div", { class: "section__list" }, ...items.map((m) => renderRow(m, { showDate: true }))),
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

function moviesByDate(bundles) {
  const map = new Map();
  for (const b of bundles) {
    for (const m of b.releases) {
      if (!passesFilter(m)) continue;
      if (!map.has(m.date)) map.set(m.date, []);
      map.get(m.date).push(m);
    }
  }
  return map;
}

function topLevelForDate(items) {
  const priority = { booked: 0, must: 1, likely: 2, potential: 3, watched: 4, not: 5 };
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

function renderCalendarDayList(items) {
  const dayBox = document.getElementById("cal-day");
  if (!dayBox) return;
  dayBox.innerHTML = "";
  if (!items || !items.length) {
    dayBox.appendChild(
      el("p", { class: "calendar__empty", text: "No releases this day." })
    );
    return;
  }
  const header = el("div", { class: "section__header" },
    el("span", { class: "section__date", text: fmtDateShort(items[0].date) }),
    el("span", { class: "section__count", text: `${items.length}` }),
  );
  const list = el("div", { class: "section__list" }, ...items.map(renderRow));
  dayBox.appendChild(el("div", { class: "section" }, header, list));
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
  const byDate = moviesByDate(bundles);

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

    const cls = [
      "calendar__cell",
      inMonth ? "" : "calendar__cell--out",
      isToday ? "calendar__cell--today" : "",
      isSelected ? "calendar__cell--selected" : "",
      items.length ? "calendar__cell--has" : "",
      topLv ? `calendar__cell--${topLv}` : "",
    ].filter(Boolean).join(" ");

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
    );
    grid.appendChild(cell);
  }

  const selectedItems = (byDate.get(calState.selected) || [])
    .slice()
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  renderCalendarDayList(selectedItems);
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
  updateCalendarSub();
}

function updateCalendarSub() {
  if (activeTab !== "calendar") return;
  const sub = document.getElementById("view-sub");
  sub.textContent = `${calState.year}`;
}

// ---------- Tabs ----------

let allBundles = [];
let activeTab = "year";

const setPanelHidden = (id, hide) => {
  const e = document.getElementById(id);
  if (e) e.hidden = hide;
};

function switchTab(tab) {
  if (tab === activeTab) return;
  activeTab = tab;
  document.querySelectorAll(".tab-bar__btn").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.tab === tab)
  );
  setPanelHidden("tab-year", tab !== "year");
  setPanelHidden("tab-calendar", tab !== "calendar");
  setPanelHidden("tab-interests", tab !== "interests");

  const title = document.getElementById("view-title");
  const sub = document.getElementById("view-sub");
  if (tab === "year") { title.textContent = "Upcoming"; sub.textContent = `${YEAR}`; }
  else if (tab === "calendar") { title.textContent = "Calendar"; sub.textContent = `${calState.year}`; }
  else { title.textContent = "Interests"; sub.textContent = ""; }

  if (tab === "interests") renderInterestsTab(allBundles);
  if (tab === "calendar") renderCalendarTab(allBundles);
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
    else if (activeTab === "calendar") renderCalendarTab(allBundles);
    else renderInterestsTab(allBundles);
  });
});
syncFilterChips();

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
  updateCalendarSub();
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

function requestBookingDate({ title, defaultDate, isUpdate }) {
  return new Promise((resolve) => {
    const dlg = document.getElementById("book-dialog");
    const input = document.getElementById("book-input");
    const copy = document.getElementById("book-copy");
    const cancel = document.getElementById("book-cancel");
    const remove = document.getElementById("book-remove");
    const form = document.getElementById("book-form");

    input.value = defaultDate || TODAY;
    copy.textContent = title
      ? `Pick the date you're seeing ${title}.`
      : "Pick the date you're seeing it.";
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
  if (activeTab === "calendar") renderCalendarTab(allBundles);
  for (const row of document.querySelectorAll(".row[data-key]")) {
    const key = row.dataset.key;
    const lvl = Interests.getLevel(key);
    row.classList.remove("row--must", "row--likely", "row--booked", "row--potential", "row--not", "row--watched");
    if (lvl) row.classList.add(`row--${lvl}`);

    const existingBadge = row.querySelector(".row__booked");
    const mark = Interests.getMark(key);
    if (lvl === "booked" && mark?.booked_date) {
      const text = `🎟  Booked for ${fmtDateShort(mark.booked_date)}`;
      if (existingBadge) {
        existingBadge.textContent = text;
      } else {
        const badge = el("div", { class: "row__booked", text });
        const metaEl = row.querySelector(".row__meta");
        const after = metaEl || row.querySelector(".row__title-line");
        after?.after(badge);
      }
    } else if (existingBadge) {
      existingBadge.remove();
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
});

Promise.all([loadYear(YEAR), Interests.load()])
  .then(([bundles]) => {
    allBundles = bundles;
    Interests.sweepPastBookings(TODAY);
    renderYearTab(bundles);
    if (activeTab === "calendar") renderCalendarTab(bundles);
    else if (activeTab === "interests") renderInterestsTab(bundles);
  })
  .catch((e) => {
    const empty = document.getElementById("empty-year");
    empty.textContent = `Couldn't load data (${e?.message || "network error"}). Kill & reopen the app.`;
    empty.hidden = false;
  });
