# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

A small PWA for tracking upcoming movie releases, AMC bookings, and repertory
screenings. Vanilla HTML / CSS / ES module JS, served as static files. Data
lives in `/data/*.json`. Service worker (`sw.js`) handles offline.

Key files:
- `index.html` — app shell.
- `styles.css` — all styling. Uses Linen design tokens (see below).
- `app.js` — main app, all rendering and interactions.
- `js/interests.js`, `js/activity.js` — interests storage and activity feed.
- `js/directors.js`, `js/studios.js` — editable Directors / Studios lists,
  synced to the private repo (`data/directors.json`, `data/studios.json`)
  with the same PAT + last-writer-wins pattern as interests. Studios ships a
  default seed of major distributors on first run.
- `sw.js` — service worker. **Bump `CACHE` version when shipping any
  shell/style/JS change**, or returning users keep the old cached copy.
- `data/*.json` — month-keyed release data + `repertory.json`.
- `scripts/fetch-*.mjs` — refresh release data, run by a workflow in
  `.github/workflows/`.

## Design system — Central Optimus

The app matches the Central Optimus launcher ("Big Type"), by the owner's
request (2026-09-28). This replaces the old Linen look; `linen-design-system-v3
(1).md` still describes spacing, radii, motion and composition, but its
colours and type no longer apply.

- Dark only: ground `#0B0B0B`, surfaces `#151515`, cream ink `#F5F2EA`,
  Optimus yellow accent `#FFE500` with near-black text on it.
- Type: DM Mono for everything (`--font-body`), Anton (`--font-display`) for
  titles and headings only. Both are self-hosted in `fonts/`; no serif, ever.
  (DM Sans is still loaded solely for the canvas share-image export.)
- Use design tokens only — no raw hex, px sizes, or font names outside
  `:root`. Change the palette in `:root`, not in rules.
- Sharp corners (4–8px); `--radius-xl` (16px) is reserved for sheets.

## Workflow

- Local dev: open `index.html` directly, or serve the folder with any static
  server. There is no build step.
- After style or shell changes, bump the `CACHE` constant in `sw.js`.
- Don't introduce frameworks, bundlers, or dependencies — the app stays
  hand-written vanilla.
