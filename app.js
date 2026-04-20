if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

const today = new Date().toISOString().slice(0, 10);

const fmtDate = (iso) => {
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

const monthFilename = (d) => {
  const monthName = d.toLocaleString("en-US", { month: "long" }).toLowerCase();
  return `./data/${monthName}-${d.getFullYear()}.json`;
};

async function loadBundles() {
  const now = new Date();
  const urls = [0, 1, 2].map((i) => monthFilename(new Date(now.getFullYear(), now.getMonth() + i, 1)));
  const results = await Promise.all(urls.map((u) =>
    fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  ));
  return results.filter(Boolean);
}

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

const wikipediaUrl = (title, date) => {
  const year = date ? date.slice(0, 4) : "";
  const q = `${title} ${year} film`.trim();
  return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q)}&go=Go`;
};

const renderRow = (m) => {
  const sub = el("dl", { class: "row__sub" },
    el("dt", { text: "Director" }), el("dd", { text: m.director }),
    el("dt", { text: "Studio" }), el("dd", { text: m.studio }),
    el("dt", { text: "Budget" }), el("dd", { text: fmtBudget(m.budget_usd, m.budget_note) }),
    m.cast && m.cast !== "—" ? el("dt", { text: "Cast" }) : null,
    m.cast && m.cast !== "—" ? el("dd", { text: m.cast }) : null,
  );

  return el("a", {
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
    sub,
    m.notes ? el("p", { class: "row__notes", text: m.notes }) : null,
  );
};

const render = (bundles) => {
  const all = bundles.flatMap((b) => b.releases).filter((r) => r.date >= today);
  all.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  const label = document.getElementById("month-label");
  if (all.length) {
    const first = new Date(all[0].date + "T12:00:00");
    const last = new Date(all[all.length - 1].date + "T12:00:00");
    const same = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
    label.textContent = same
      ? first.toLocaleString(undefined, { month: "long", year: "numeric" })
      : `${first.toLocaleString(undefined, { month: "short" })} – ${last.toLocaleString(undefined, { month: "short", year: "numeric" })}`;
  } else {
    label.textContent = "Upcoming";
  }

  const list = document.getElementById("list");
  list.innerHTML = "";

  if (!all.length) {
    document.getElementById("empty").hidden = false;
    return;
  }
  document.getElementById("empty").hidden = true;

  for (const [date, items] of groupByDate(all)) {
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

loadBundles().then(render).catch(() => { document.getElementById("empty").hidden = false; });
