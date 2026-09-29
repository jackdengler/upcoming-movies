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

- Dark by default: ground `#0B0B0B`, surfaces `#151515`, cream ink `#F5F2EA`,
  Optimus yellow accent `#FFE500` with near-black text on it.
- Light mode: `:root[data-theme="light"]` overrides the same tokens. The
  theme is the shared `co.theme` localStorage key ("dark" | "light"), read by
  the head script in `index.html` and shared with the launcher and other apps
  on this origin. Accent as *text or line* uses `--color-accent-ink` (dark
  mustard in light mode); `--color-accent` is for fills only.
- Type: DM Mono for everything (`--font-body`), Anton (`--font-display`) for
  titles and headings only. Both are self-hosted in `fonts/`; no serif, ever.
  (DM Sans is still loaded solely for the canvas share-image export.)
- Use design tokens only — no raw hex, px sizes, or font names outside
  `:root`. Change the palette in `:root`, not in rules.
- Square edges: the radius tokens are 0 (pills only for switches, badges,
  dots). Soft shadows are off (`--shadow-sm/md: none`).
- "Big Type skin" at the end of `styles.css`: Anton titles/dates, wine
  month bands (`--color-brand`, the launcher's Movies colour) with the
  diagonal cut, flat cards on hairlines, square interest strip. Trailer
  buttons show the trailer's YouTube still (`i.ytimg.com`, lazy).

## Workflow

- Local dev: open `index.html` directly, or serve the folder with any static
  server. There is no build step.
- After style or shell changes, bump the `CACHE` constant in `sw.js`.
- Don't introduce frameworks, bundlers, or dependencies — the app stays
  hand-written vanilla.
