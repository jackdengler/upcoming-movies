// Storage for the Directors tab. Same private repo + PAT as Interests,
// stored at data/directors.json. File-level last-writer-wins: each commit
// stamps a top-level `updated` ISO and load() picks the newer of local /
// remote. Multi-device conflicts in the (rare) overlapping-edit window
// can drop one device's change — acceptable for a single-user list.

const REPO = "jackdengler/private-data-storage";
const PATH = "data/directors.json";
const BRANCH = "main";
const PAT_KEY = "upcoming:gh_pat";
const CACHE_KEY = "upcoming:directors";
const DEBOUNCE_MS = 2500;

const state = {
  updated: null,
  directors: [],
  sha: null,
  loaded: false,
  // Mirrors interests.js — block commits until we've confirmed remote state
  // this session so a fresh install can't blow away the populated remote.
  remoteLoaded: false,
  pendingTimer: null,
  listeners: new Set(),
};

function emit() {
  for (const fn of state.listeners) fn(state.directors);
}

export function onChange(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export function all() {
  return state.directors.slice();
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
      directors: state.directors,
    }));
  } catch {}
}

function adoptPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const list = Array.isArray(payload.directors) ? payload.directors : [];
  state.directors = list
    .filter((d) => d && typeof d.name === "string" && d.name.trim())
    .map((d) => ({
      id: String(d.id || newId()),
      name: String(d.name).trim(),
      notes: typeof d.notes === "string" ? d.notes : "",
      addedAt: typeof d.addedAt === "string" ? d.addedAt : new Date().toISOString(),
    }));
  state.updated = typeof payload.updated === "string" ? payload.updated : null;
  return true;
}

export async function load() {
  const cached = readCache();
  if (cached) adoptPayload(cached);
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
        writeCache();
        emit();
      }
      state.remoteLoaded = true;
    } else if (r.status === 404) {
      state.remoteLoaded = true;
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
    console.warn("Skipping directors commit: remote not yet loaded.");
    return;
  }

  if (state.sha === null) state.sha = await fetchSha();

  const payload = {
    updated: state.updated || new Date().toISOString(),
    directors: state.directors,
  };
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2) + "\n")));

  const body = {
    message: "Update directors",
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
  emit();
  writeCache();
  scheduleCommit();
}

function newId() {
  return (crypto?.randomUUID?.() || `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
}

export function add(name, notes = "") {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const entry = {
    id: newId(),
    name: clean,
    notes: String(notes || "").trim(),
    addedAt: new Date().toISOString(),
  };
  state.directors.push(entry);
  touch();
  return entry.id;
}

export function update(id, fields) {
  const idx = state.directors.findIndex((d) => d.id === id);
  if (idx < 0) return false;
  const cur = state.directors[idx];
  const next = { ...cur };
  if (typeof fields.name === "string") {
    const name = fields.name.trim();
    if (!name) return false;
    next.name = name;
  }
  if (typeof fields.notes === "string") next.notes = fields.notes.trim();
  state.directors[idx] = next;
  touch();
  return true;
}

export function remove(id) {
  const before = state.directors.length;
  state.directors = state.directors.filter((d) => d.id !== id);
  if (state.directors.length === before) return false;
  touch();
  return true;
}

// Swap entry `id` with its neighbor in direction `delta` (-1 up, +1 down).
// Returns true if the order changed. No-op when already at the edge.
export function move(id, delta) {
  const idx = state.directors.findIndex((d) => d.id === id);
  if (idx < 0) return false;
  const target = idx + delta;
  if (target < 0 || target >= state.directors.length) return false;
  const a = state.directors[idx];
  state.directors[idx] = state.directors[target];
  state.directors[target] = a;
  touch();
  return true;
}

function scheduleCommit() {
  setSync("pending");
  clearTimeout(state.pendingTimer);
  state.pendingTimer = setTimeout(() => {
    commit().catch((e) => console.warn("Directors commit failed:", e.message));
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
