if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

const DATA_URL = "./data/may-2026.json";

const fmtDate = (iso) => {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric" });
};

const fmtBudget = (usd, note) => {
  if (usd == null) return "Undisclosed";
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

const groupByDate = (rows) => {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.date)) map.set(r.date, []);
    map.get(r.date).push(r);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
};

const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return n;
};

const renderRow = (m) => {
  const sub = el("dl", { class: "row__sub" },
    el("dt", { text: "Director" }), el("dd", { text: m.director }),
    el("dt", { text: "Studio" }), el("dd", { text: m.studio }),
    el("dt", { text: "Budget" }), el("dd", { text: fmtBudget(m.budget_usd, m.budget_note) }),
    m.cast && m.cast !== "—" ? el("dt", { text: "Cast" }) : null,
    m.cast && m.cast !== "—" ? el("dd", { text: m.cast }) : null,
  );

  return el("article", { class: "row" },
    el("div", { class: "row__title-line" },
      el("h3", { class: "row__title", text: m.title }),
      el("span", { class: chipClass(m.release_type), text: chipLabel(m.release_type) }),
    ),
    el("div", { class: "row__meta", text: m.genre }),
    sub,
    m.notes ? el("p", { class: "row__notes", text: m.notes }) : null,
  );
};

const render = (data) => {
  document.getElementById("month-label").textContent = data.month;
  const list = document.getElementById("list");
  list.innerHTML = "";

  const groups = groupByDate(data.releases);
  if (!groups.length) {
    document.getElementById("empty").hidden = false;
    return;
  }

  for (const [date, items] of groups) {
    const section = el("section", { class: "section" },
      el("header", { class: "section__header" },
        el("span", { class: "section__date", text: fmtDate(date) }),
        el("span", { class: "section__count", text: `${items.length} ${items.length === 1 ? "release" : "releases"}` }),
      ),
      el("div", { class: "section__list" }, ...items.map(renderRow)),
    );
    list.appendChild(section);
  }
};

fetch(DATA_URL, { cache: "no-cache" })
  .then((r) => r.json())
  .then(render)
  .catch(() => { document.getElementById("empty").hidden = false; });
