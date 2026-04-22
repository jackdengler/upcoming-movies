const SNAPSHOT_KEY = "upcoming:snapshot";
const LOG_KEY = "upcoming:activity";
const SEEN_KEY = "upcoming:activity-seen";
const MAX_EVENTS = 200;

const RELEASE_FIELDS = ["date", "release_type", "studio", "director", "title"];
const SCREENING_FIELDS = ["date", "time", "format", "theater", "title"];

const FIELD_LABEL = {
  date: "Release date",
  release_type: "Release type",
  studio: "Studio",
  director: "Director",
  title: "Title",
  time: "Showtime",
  format: "Format",
  theater: "Theater",
};

const listeners = new Set();

function emit() {
  for (const fn of listeners) fn();
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSnapshot(snap) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {}
}

export function readLog() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLog(events) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(events));
  } catch {}
}

export function getLastSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) || "";
  } catch {
    return "";
  }
}

export function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, new Date().toISOString());
  } catch {}
  emit();
}

export function unreadCount() {
  const seen = getLastSeen();
  const log = readLog();
  if (!seen) return log.length;
  let n = 0;
  for (const ev of log) {
    if (ev.at > seen) n++;
  }
  return n;
}

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

function releaseKey(m) {
  if (m.tmdb_id) return `tmdb:${m.tmdb_id}`;
  return null;
}

function screeningKey(s) {
  if (!s.theater || !s.date || !s.title) return null;
  return `rep:${s.theater}:${s.date}:${s.time || ""}:${slugify(s.title)}`;
}

function pickFields(m, fields) {
  const out = {};
  for (const f of fields) if (m[f] != null) out[f] = m[f];
  return out;
}

function buildReleaseIndex(bundles) {
  const index = {};
  for (const b of bundles) {
    for (const m of b.releases || []) {
      const key = releaseKey(m);
      if (!key) continue;
      index[key] = {
        ...pickFields(m, RELEASE_FIELDS),
        tmdb_id: m.tmdb_id || null,
      };
    }
  }
  return index;
}

function buildScreeningIndex(screenings) {
  const index = {};
  for (const s of screenings) {
    const key = screeningKey(s);
    if (!key) continue;
    index[key] = pickFields(s, SCREENING_FIELDS);
  }
  return index;
}

function diffIndex(prev, curr, { kind, fields, meta }) {
  const events = [];
  const at = new Date().toISOString();

  for (const [key, m] of Object.entries(curr)) {
    const was = prev[key];
    if (!was) {
      events.push({
        at,
        kind,
        type: "added",
        key,
        title: m.title || "Unknown",
        date: m.date || null,
        ...meta(m),
      });
      continue;
    }
    for (const field of fields) {
      if (field === "title") continue;
      if (was[field] !== m[field] && was[field] != null && m[field] != null) {
        events.push({
          at,
          kind,
          type: "changed",
          field,
          key,
          title: m.title || was.title || "Unknown",
          date: m.date || null,
          ...meta(m),
          from: was[field],
          to: m[field],
        });
      }
    }
  }

  for (const [key, was] of Object.entries(prev)) {
    if (!curr[key]) {
      events.push({
        at,
        kind,
        type: "removed",
        key,
        title: was.title || "Unknown",
        date: was.date || null,
        ...meta(was),
      });
    }
  }

  return events;
}

export function ingest(input) {
  // Back-compat: earlier versions called `ingest(bundles)` directly.
  const bundles = Array.isArray(input) ? input : input?.bundles || [];
  const screenings = Array.isArray(input) ? [] : input?.screenings || [];

  const currReleases = buildReleaseIndex(bundles);
  const currScreenings = buildScreeningIndex(screenings);
  const prevWrap = readSnapshot();
  const prevReleases = prevWrap?.movies || null;
  // Legacy snapshots (no screenings slice) shouldn't flood Updates with
  // "added" events on first run after the upgrade.
  const prevScreenings = prevWrap?.screenings ?? (prevWrap ? {} : null);

  if (!prevReleases) {
    writeSnapshot({
      movies: currReleases,
      screenings: currScreenings,
      at: new Date().toISOString(),
    });
    emit();
    return { firstRun: true, newEvents: [] };
  }

  const releaseEvents = diffIndex(prevReleases, currReleases, {
    kind: "release",
    fields: RELEASE_FIELDS,
    meta: (m) => ({
      release_type: m.release_type || null,
      tmdb_id: m.tmdb_id || null,
    }),
  });

  const screeningEvents = prevScreenings
    ? diffIndex(prevScreenings, currScreenings, {
        kind: "screening",
        fields: SCREENING_FIELDS,
        meta: (m) => ({
          theater: m.theater || null,
          time: m.time || null,
          format: m.format || null,
        }),
      })
    : [];

  const newEvents = [...releaseEvents, ...screeningEvents];
  if (newEvents.length) {
    const log = readLog();
    const merged = [...newEvents, ...log].slice(0, MAX_EVENTS);
    writeLog(merged);
  }
  writeSnapshot({
    movies: currReleases,
    screenings: currScreenings,
    at: new Date().toISOString(),
  });
  emit();
  return { firstRun: false, newEvents };
}

export function clear() {
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {}
  emit();
}

export { FIELD_LABEL };
