const REPO = "jackdengler/private-data-storage";
const PATH = "data/interests.json";
const BRANCH = "main";
const PAT_KEY = "upcoming:gh_pat";
const CACHE_KEY = "upcoming:interests";
const DEBOUNCE_MS = 2500;

const LEVELS = ["watched", "booked", "must", "likely", "potential", "not"];

const state = {
  marks: {},
  sha: null,
  loaded: false,
  // True only after we've definitively read remote state this session
  // (200 OK with parsed body, or 404 confirming the file doesn't exist).
  // Commits are blocked until this flips true so a fresh-install with an
  // empty local cache can't overwrite a populated remote.
  remoteLoaded: false,
  pendingTimer: null,
  listeners: new Set(),
};

function emit() {
  for (const fn of state.listeners) fn(state.marks);
}

export function onChange(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export function getLevel(key) {
  return state.marks[key]?.level || null;
}

export function allMarks() {
  return { ...state.marks };
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.marks)); } catch {}
}

function isNewer(a, b) {
  if (!a?.at) return false;
  if (!b?.at) return true;
  return a.at > b.at;
}

function mergeRemote(remoteMarks) {
  let changed = false;
  for (const [key, remote] of Object.entries(remoteMarks)) {
    const local = state.marks[key];
    if (!local || isNewer(remote, local)) {
      state.marks[key] = remote;
      changed = true;
    }
  }
  return changed;
}

export async function load() {
  // 1. Hydrate from localStorage instantly
  const cached = readCache();
  if (cached && typeof cached === "object") {
    state.marks = cached;
  }
  state.loaded = true;
  emit();

  // 2. Merge with remote (prefer newer 'at' timestamps).
  // The watchlist now lives in a private repo, so the read needs the PAT.
  // Without it, we keep using the localStorage cache and let the user paste
  // a token via the Connect-GitHub dialog.
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
      }
    );
    if (r.ok) {
      const j = await r.json();
      const remote = j.marks || {};
      if (mergeRemote(remote)) {
        writeCache();
        emit();
      }
      state.remoteLoaded = true;
    } else if (r.status === 404) {
      // File doesn't exist yet; commit will create it.
      state.remoteLoaded = true;
    }
    // Auth/server errors: leave remoteLoaded false so commit() bails out.
  } catch {}
}

async function fetchSha() {
  const pat = getPat();
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`, {
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
  });
  if (!r.ok) throw new Error(`Fetch SHA failed: ${r.status}`);
  const j = await r.json();
  return j.sha;
}

async function commit() {
  const pat = getPat();
  if (!pat) return;

  // Refuse to write until we've successfully read the remote this session.
  // Otherwise a fresh PWA install (empty localStorage) + new PAT would PUT
  // an empty marks object over the populated remote file.
  if (!state.remoteLoaded) {
    setSync("error");
    console.warn("Skipping interests commit: remote not yet loaded.");
    return;
  }

  if (!state.sha) state.sha = await fetchSha();

  const payload = {
    updated: new Date().toISOString(),
    marks: state.marks,
  };
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2) + "\n")));

  const body = {
    message: "Update interests",
    content,
    sha: state.sha,
    branch: BRANCH,
  };

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
    body.sha = state.sha;
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

export function set(key, level, meta = {}) {
  if (level && !LEVELS.includes(level)) return;
  if (!level) {
    delete state.marks[key];
  } else {
    state.marks[key] = { level, at: new Date().toISOString(), ...meta };
  }
  emit();
  writeCache();
  scheduleCommit();
}

export function getMark(key) {
  return state.marks[key] || null;
}

// Move any booked marks whose booked_date is strictly before `today` (YYYY-MM-DD)
// into the "watched" state. Preserves booked_date as a historical field.
// Returns true if anything changed.
export function sweepPastBookings(today) {
  let changed = false;
  for (const [key, mark] of Object.entries(state.marks)) {
    if (mark?.level !== "booked") continue;
    const bd = mark.booked_date;
    if (!bd || bd >= today) continue;
    state.marks[key] = {
      ...mark,
      level: "watched",
      watched_date: mark.watched_date || bd,
      at: new Date().toISOString(),
    };
    changed = true;
  }
  if (changed) {
    emit();
    writeCache();
    scheduleCommit();
  }
  return changed;
}

function scheduleCommit() {
  setSync("pending");
  clearTimeout(state.pendingTimer);
  state.pendingTimer = setTimeout(() => {
    commit().catch((e) => console.warn("Interest commit failed:", e.message));
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

export function setPat(token) {
  if (!token) {
    localStorage.removeItem(PAT_KEY);
    state.sha = null;
    state.remoteLoaded = false;
    return;
  }
  localStorage.setItem(PAT_KEY, token);
  state.sha = null;
  // Fresh token → re-verify remote before allowing commits.
  state.remoteLoaded = false;
}

export function hasPat() {
  return Boolean(getPat());
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
