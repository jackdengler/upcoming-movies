// Storage for the Studios tab. Same private repo + PAT as Interests /
// Directors, stored at data/studios.json. File-level last-writer-wins: each
// commit stamps a top-level `updated` ISO and load() picks the newer of
// local / remote. Multi-device conflicts in the (rare) overlapping-edit
// window can drop one device's change — acceptable for a single-user list.
//
// Unlike Directors, the Studios list ships with a default seed of major
// distributors so a brand-new install lands on a populated tab. The seed is
// adopted only on first run (no local cache); once the user has a cache —
// even an empty one, because they removed every studio — we never re-seed.

const REPO = "jackdengler/private-data-storage";
const PATH = "data/studios.json";
const BRANCH = "main";
const PAT_KEY = "upcoming:gh_pat";
const CACHE_KEY = "upcoming:studios";
const DEBOUNCE_MS = 2500;

// Major theatrical distributors, seeded on first run. `name` doubles as the
// display label and a match target; `aliases` catch the variant spellings
// the data sometimes uses for the same distributor (e.g. a Sony sub-label).
// Keep this in sync with the real `studio` strings in data/*.json.
const DEFAULT_STUDIOS = [
  { name: "Walt Disney Studios Motion Pictures", aliases: ["Walt Disney Studios", "Disney"] },
  { name: "Warner Bros.", aliases: ["Warner Bros. Pictures", "Warner Brothers"] },
  { name: "Universal Pictures", aliases: ["Universal"] },
  { name: "Sony Pictures Releasing", aliases: ["Sony Pictures", "Columbia Pictures"] },
  { name: "Paramount Pictures", aliases: ["Paramount", "Republic Pictures"] },
  { name: "Lionsgate", aliases: ["Lionsgate Premiere"] },
  { name: "20th Century Studios", aliases: ["20th Century Fox"] },
  { name: "Searchlight Pictures", aliases: ["Fox Searchlight"] },
  { name: "Amazon MGM Studios", aliases: ["Amazon MGM", "MGM"] },
  { name: "A24", aliases: [] },
  { name: "Neon", aliases: [] },
  { name: "Focus Features", aliases: [] },
];

const state = {
  updated: null,
  studios: [],
  sha: null,
  loaded: false,
  // Mirrors interests.js — block commits until we've confirmed remote state
  // this session so a fresh install can't blow away the populated remote.
  remoteLoaded: false,
  // True when load() adopted the built-in seed (no local cache existed). Used
  // to push the seed up the first time we confirm the remote has no file yet.
  seeded: false,
  pendingTimer: null,
  listeners: new Set(),
};

function emit() {
  for (const fn of state.listeners) fn(state.studios);
}

export function onChange(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export function all() {
  return state.studios.slice();
}

function newId() {
  return (crypto?.randomUUID?.() || `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
}

function seedEntries() {
  const now = new Date().toISOString();
  return DEFAULT_STUDIOS.map((s) => ({
    id: newId(),
    name: s.name,
    aliases: Array.isArray(s.aliases) ? s.aliases.slice() : [],
    notes: "",
    addedAt: now,
  }));
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      updated: state.updated,
      studios: state.studios,
    }));
  } catch {}
}

function adoptPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const list = Array.isArray(payload.studios) ? payload.studios : [];
  state.studios = list
    .filter((s) => s && typeof s.name === "string" && s.name.trim())
    .map((s) => ({
      id: String(s.id || newId()),
      name: String(s.name).trim(),
      aliases: Array.isArray(s.aliases)
        ? s.aliases.filter((a) => typeof a === "string" && a.trim()).map((a) => a.trim())
        : [],
      notes: typeof s.notes === "string" ? s.notes : "",
      addedAt: typeof s.addedAt === "string" ? s.addedAt : new Date().toISOString(),
    }));
  state.updated = typeof payload.updated === "string" ? payload.updated : null;
  return true;
}

export async function load() {
  const cached = readCache();
  if (cached) {
    adoptPayload(cached);
  } else {
    // First run on this device: adopt the seed locally so the tab isn't
    // empty even before (or without) a PAT. `updated` stays null so a real
    // remote list always wins over the seed.
    state.studios = seedEntries();
    state.updated = null;
    state.seeded = true;
    writeCache();
  }
  state.loaded = true;
  emit();

  const pat = getPat();
  if (!pat) return;
  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${BRANCH}&t=${Date.now()}`,
      {
        cache: "no-cache",
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github.raw",
        },
      },
    );
    if (r.ok) {
      const j = await r.json();
      // Remote wins if its `updated` is strictly newer than local; otherwise
      // keep local (which may include unsynced edits from this session).
      if (typeof j?.updated === "string" && (!state.updated || j.updated > state.updated)) {
        adoptPayload(j);
        state.seeded = false;
        writeCache();
        emit();
      }
      state.remoteLoaded = true;
    } else if (r.status === 404) {
      state.remoteLoaded = true;
      // No remote file yet. If all we have is the local seed, push it up so
      // the user's other devices inherit the same starting set.
      if (state.seeded) {
        state.updated = new Date().toISOString();
        writeCache();
        scheduleCommit();
      }
    }
  } catch {}
}

async function fetchSha() {
  const pat = getPat();
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`, {
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Fetch SHA failed: ${r.status}`);
  const j = await r.json();
  return j.sha || null;
}

async function commit() {
  const pat = getPat();
  if (!pat) return;

  if (!state.remoteLoaded) {
    setSync("error");
    console.warn("Skipping studios commit: remote not yet loaded.");
    return;
  }

  if (state.sha === null) state.sha = await fetchSha();

  const payload = {
    updated: state.updated || new Date().toISOString(),
    studios: state.studios,
  };
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2) + "\n")));

  const body = {
    message: "Update studios",
    content,
    branch: BRANCH,
  };
  if (state.sha) body.sha = state.sha;

  setSync("saving");
  let r = await fetch(`https://api.github.com/repos/${REPO}/contents/${PATH}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (r.status === 409 || r.status === 422) {
    state.sha = await fetchSha();
    if (state.sha) body.sha = state.sha; else delete body.sha;
    r = await fetch(`https://api.github.com/repos/${REPO}/contents/${PATH}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  if (!r.ok) {
    setSync("error");
    throw new Error(`Commit failed: ${r.status}`);
  }
  const j = await r.json();
  state.sha = j.content?.sha || null;
  setSync("saved");
  setTimeout(() => setSync(null), 1500);
}

function touch() {
  state.updated = new Date().toISOString();
  state.seeded = false;
  emit();
  writeCache();
  scheduleCommit();
}

export function add(name, notes = "") {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const entry = {
    id: newId(),
    name: clean,
    aliases: [],
    notes: String(notes || "").trim(),
    addedAt: new Date().toISOString(),
  };
  state.studios.push(entry);
  touch();
  return entry.id;
}

export function update(id, fields) {
  const idx = state.studios.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  const cur = state.studios[idx];
  const next = { ...cur };
  if (typeof fields.name === "string") {
    const name = fields.name.trim();
    if (!name) return false;
    next.name = name;
  }
  if (typeof fields.notes === "string") next.notes = fields.notes.trim();
  state.studios[idx] = next;
  touch();
  return true;
}

export function remove(id) {
  const before = state.studios.length;
  state.studios = state.studios.filter((s) => s.id !== id);
  if (state.studios.length === before) return false;
  touch();
  return true;
}

// Swap entry `id` with its neighbor in direction `delta` (-1 up, +1 down).
// Returns true if the order changed. No-op when already at the edge.
export function move(id, delta) {
  const idx = state.studios.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  const target = idx + delta;
  if (target < 0 || target >= state.studios.length) return false;
  const a = state.studios[idx];
  state.studios[idx] = state.studios[target];
  state.studios[target] = a;
  touch();
  return true;
}

function scheduleCommit() {
  setSync("pending");
  clearTimeout(state.pendingTimer);
  state.pendingTimer = setTimeout(() => {
    commit().catch((e) => console.warn("Studios commit failed:", e.message));
  }, DEBOUNCE_MS);
}

export function flush() {
  if (state.pendingTimer) {
    clearTimeout(state.pendingTimer);
    state.pendingTimer = null;
    return commit().catch(() => {});
  }
}

export function getPat() {
  return localStorage.getItem(PAT_KEY) || null;
}

function setSync(status) {
  const n = document.getElementById("sync-indicator");
  if (!n) return;
  if (!status) { n.hidden = true; n.textContent = ""; return; }
  n.hidden = false;
  const map = { pending: "•", saving: "Saving…", saved: "✓ Saved", error: "! Sync failed" };
  n.textContent = map[status] || "";
  n.dataset.status = status;
}

window.addEventListener("beforeunload", () => { flush(); });
window.addEventListener("pagehide", () => { flush(); });
window.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
