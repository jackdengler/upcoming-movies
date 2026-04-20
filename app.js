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

const LEVEL_LABEL = {
  must: "Must",
  likely: "Likely",
  potential: "Maybe",
  not: "Skip",
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

// ---------- Row rendering & swipe ----------

let openSwipeRow = null;

function closeSwipe(row) {
  if (!row) return;
  row.classList.remove("is-open");
  row.style.transform = "";
  if (openSwipeRow === row) openSwipeRow = null;
}

function openSwipe(row) {
  if (openSwipeRow && openSwipeRow !== row) closeSwipe(openSwipeRow);
  row.classList.add("is-open");
  row.style.transform = "translateX(-228px)";
  openSwipeRow = row;
}

function attachSwipe(wrap, row, movie) {
  let startX = 0, startY = 0, dx = 0, isHorizontal = null, moved = false;
  const REVEAL = 228;
  const OPEN_THRESHOLD = 80;

  const onStart = (e) => {
    if (e.target.closest(".action-btn")) return;
    const t = e.touches ? e.touches[0] : e;
    startX = t.clientX;
    startY = t.clientY;
    dx = 0;
    isHorizontal = null;
    moved = false;
    row.style.transition = "none";
  };

  const onMove = (e) => {
    const t = e.touches ? e.touches[0] : e;
    const rawDx = t.clientX - startX;
    const rawDy = t.clientY - startY;

    if (isHorizontal === null) {
      if (Math.abs(rawDx) < 8 && Math.abs(rawDy) < 8) return;
      isHorizontal = Math.abs(rawDx) > Math.abs(rawDy);
    }
    if (!isHorizontal) return;

    e.preventDefault();
    moved = true;
    const base = row.classList.contains("is-open") ? -REVEAL : 0;
    dx = Math.max(-REVEAL - 20, Math.min(20, base + rawDx));
    row.style.transform = `translateX(${dx}px)`;
  };

  const onEnd = () => {
    row.style.transition = "";
    if (!moved) return;
    const shouldOpen = dx < -OPEN_THRESHOLD;
    if (shouldOpen) openSwipe(row);
    else closeSwipe(row);
  };

  row.addEventListener("touchstart", onStart, { passive: true });
  row.addEventListener("touchmove", onMove, { passive: false });
  row.addEventListener("touchend", onEnd);
  row.addEventListener("touchcancel", onEnd);

  row.addEventListener("click", (e) => {
    if (row.classList.contains("is-open")) {
      e.preventDefault();
      closeSwipe(row);
    }
  }, true);
}

function renderActions(movie) {
  const current = Interests.getLevel(movieKey(movie));
  const levels = ["must", "likely", "potential", "not"];
  return el("div", { class: "row-actions" },
    ...levels.map((lv) =>
      el("button", {
          type: "button",
          class: `action-btn action-btn--${lv}${current === lv ? " is-active" : ""}`,
          "data-level": lv,
          "aria-label": LEVEL_LABEL[lv],
        },
        el("span", { class: "action-btn__icon", "aria-hidden": "true" }),
        el("span", { class: "action-btn__label", text: LEVEL_LABEL[lv] }),
      )
    ),
  );
}

function renderRow(m) {
  const level = Interests.getLevel(movieKey(m));

  const content = el("a", {
      class: `row${level ? ` row--${level}` : ""}`,
      href: wikipediaUrl(m.title, m.date),
      target: "_blank",
      rel: "noopener noreferrer",
      dataset: { key: movieKey(m) },
    },
    el("div", { class: "row__title-line" },
      el("h3", { class: "row__title", text: m.title }),
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
  );

  const wrap = el("div", { class: "row-wrap", dataset: { key: movieKey(m) } },
    renderActions(m),
    content,
  );

  wrap.addEventListener("click", async (e) => {
    const btn = e.target.closest(".action-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const level = btn.dataset.level;
    const key = movieKey(m);
    if (!Interests.hasPat()) {
      const saved = await requestPat();
      if (!saved) return;
    }
    const current = Interests.getLevel(key);
    Interests.set(key, current === level ? null : level, {
      title: m.title,
      date: m.date,
      tmdb_id: m.tmdb_id || null,
    });
    closeSwipe(content);
  });

  attachSwipe(wrap, content, m);
  return wrap;
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
  const open = key === CURRENT_MONTH_KEY || key === NEXT_MONTH_KEY;
  const isPast = key < CURRENT_MONTH_KEY;
  const groups = groupByDate(bundle.releases);
  const count = bundle.releases.length;

  return el("details", {
      class: isPast ? "month month--past" : "month",
      open,
      dataset: { monthKey: key },
    },
    el("summary", { class: "month__summary" },
      el("span", { class: "month__chevron", "aria-hidden": "true" }),
      el("span", { class: "month__name", text: bundle.month }),
      el("span", { class: "month__count", text: `${count}` }),
    ),
    el("div", { class: "month__body" }, ...groups.map(renderDateGroup)),
  );
}

// ---------- Interests tab rendering ----------

function renderInterestsTab(bundles) {
  const list = document.getElementById("interest-list");
  list.innerHTML = "";

  const allMovies = bundles.flatMap((b) => b.releases);
  const byKey = new Map(allMovies.map((m) => [movieKey(m), m]));

  const marks = Interests.allMarks();
  const grouped = { must: [], likely: [], potential: [], not: [] };

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
    if (grouped[meta.level]) grouped[meta.level].push(movie);
  }

  const order = ["must", "likely", "potential", "not"];
  const titles = { must: "Must watch", likely: "Likely watch", potential: "Potential", not: "Not interested" };

  const empty = document.getElementById("empty-interests");
  const total = order.reduce((a, k) => a + grouped[k].length, 0);
  if (!total) {
    empty.hidden = false;
    return;
  }
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
  bundles.sort((a, b) => monthKeyOf(a).localeCompare(monthKeyOf(b)));

  const list = document.getElementById("list");
  list.innerHTML = "";

  const empty = document.getElementById("empty-year");
  if (!bundles.length) { empty.hidden = false; return; }
  empty.hidden = true;

  for (const b of bundles) list.appendChild(renderMonth(b));

  requestAnimationFrame(() => {
    const current = list.querySelector(`[data-month-key="${CURRENT_MONTH_KEY}"]`);
    if (current) current.scrollIntoView({ block: "start", behavior: "instant" });
  });
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

document.addEventListener("click", (e) => {
  if (!openSwipeRow) return;
  if (e.target.closest(".row-wrap") === openSwipeRow.parentElement) return;
  closeSwipe(openSwipeRow);
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

// ---------- Boot ----------

Interests.onChange(() => {
  if (activeTab === "interests") renderInterestsTab(allBundles);
  for (const row of document.querySelectorAll(".row[data-key]")) {
    const lvl = Interests.getLevel(row.dataset.key);
    row.classList.remove("row--must", "row--likely", "row--potential", "row--not");
    if (lvl) row.classList.add(`row--${lvl}`);
  }
  for (const btn of document.querySelectorAll(".action-btn")) {
    const wrap = btn.closest(".row-wrap");
    if (!wrap) continue;
    const lvl = Interests.getLevel(wrap.dataset.key);
    btn.classList.toggle("is-active", btn.dataset.level === lvl);
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
