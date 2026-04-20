if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
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

const renderRow = (m) =>
  el("a", {
      class: "row",
      href: wikipediaUrl(m.title, m.date),
      target: "_blank",
      rel: "noopener noreferrer",
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

const renderDateGroup = ([date, items]) =>
  el("section", { class: "section" },
    el("header", { class: "section__header" },
      el("span", { class: "section__date", text: fmtDateShort(date) }),
      el("span", { class: "section__count", text: `${items.length}` }),
    ),
    el("div", { class: "section__list" }, ...items.map(renderRow)),
  );

const renderMonth = (bundle) => {
  const key = monthKeyOf(bundle);
  const open = key === CURRENT_MONTH_KEY || key === NEXT_MONTH_KEY;
  const isPast = key < CURRENT_MONTH_KEY;
  const groups = groupByDate(bundle.releases);
  const count = bundle.releases.length;

  return el("details", {
      class: isPast ? "month month--past" : "month",
      open,
      "data-month-key": key,
    },
    el("summary", { class: "month__summary" },
      el("span", { class: "month__chevron", "aria-hidden": "true" }),
      el("span", { class: "month__name", text: bundle.month }),
      el("span", { class: "month__count", text: `${count}` }),
    ),
    el("div", { class: "month__body" }, ...groups.map(renderDateGroup)),
  );
};

const render = (bundles) => {
  bundles = bundles.filter((b) => b.releases && b.releases.length);
  bundles.sort((a, b) => monthKeyOf(a).localeCompare(monthKeyOf(b)));

  const label = document.getElementById("month-label");
  label.textContent = `${YEAR}`;

  const list = document.getElementById("list");
  list.innerHTML = "";

  if (!bundles.length) {
    document.getElementById("empty").hidden = false;
    return;
  }
  document.getElementById("empty").hidden = true;

  for (const b of bundles) list.appendChild(renderMonth(b));

  requestAnimationFrame(() => {
    const current = list.querySelector(`[data-month-key="${CURRENT_MONTH_KEY}"]`);
    if (current) current.scrollIntoView({ block: "start", behavior: "instant" });
  });
};

loadYear(YEAR)
  .then(render)
  .catch(() => { document.getElementById("empty").hidden = false; });
