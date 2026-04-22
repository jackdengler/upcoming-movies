const SNAPSHOT_KEY = "upcoming:snapshot";
const LOG_KEY = "upcoming:activity";
const SEEN_KEY = "upcoming:activity-seen";
const MAX_EVENTS = 200;

const TRACKED_FIELDS = ["date", "release_type", "studio", "director", "title"];

const FIELD_LABEL = {
  date: "Release date",
  release_type: "Release type",
  studio: "Studio",
  director: "Director",
  title: "Title",
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

function movieKey(m) {
  if (m.tmdb_id) return `tmdb:${m.tmdb_id}`;
  return null;
}

function pickTracked(m) {
  const out = {};
  for (const f of TRACKED_FIELDS) {
    if (m[f] != null) out[f] = m[f];
  }
  return out;
}

function buildIndex(bundles) {
  const index = {};
  for (const b of bundles) {
    for (const m of b.releases || []) {
      const key = movieKey(m);
      if (!key) continue;
      index[key] = {
        ...pickTracked(m),
        tmdb_id: m.tmdb_id || null,
      };
    }
  }
  return index;
}

function diff(prev, curr) {
  const events = [];
  const at = new Date().toISOString();

  for (const [key, m] of Object.entries(curr)) {
    const was = prev[key];
    if (!was) {
      events.push({
        at,
        type: "added",
        key,
        title: m.title || "Unknown",
        date: m.date || null,
        release_type: m.release_type || null,
        tmdb_id: m.tmdb_id || null,
      });
      continue;
    }
    for (const field of TRACKED_FIELDS) {
      if (field === "title") continue;
      if (was[field] !== m[field] && was[field] != null && m[field] != null) {
        events.push({
          at,
          type: "changed",
          field,
          key,
          title: m.title || was.title || "Unknown",
          date: m.date || null,
          tmdb_id: m.tmdb_id || null,
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
        type: "removed",
        key,
        title: was.title || "Unknown",
        date: was.date || null,
        release_type: was.release_type || null,
        tmdb_id: was.tmdb_id || null,
      });
    }
  }

  return events;
}

export function ingest(bundles) {
  const curr = buildIndex(bundles);
  const prevWrap = readSnapshot();
  const prev = prevWrap?.movies || null;

  if (!prev) {
    writeSnapshot({ movies: curr, at: new Date().toISOString() });
    emit();
    return { firstRun: true, newEvents: [] };
  }

  const newEvents = diff(prev, curr);
  if (newEvents.length) {
    const log = readLog();
    const merged = [...newEvents, ...log].slice(0, MAX_EVENTS);
    writeLog(merged);
  }
  writeSnapshot({ movies: curr, at: new Date().toISOString() });
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
