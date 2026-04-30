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
- `sw.js` — service worker. **Bump `CACHE` version when shipping any
  shell/style/JS change**, or returning users keep the old cached copy.
- `data/*.json` — month-keyed release data + `repertory.json`.
- `scripts/fetch-*.mjs` — refresh release data, run by a workflow in
  `.github/workflows/`.

## Design system — non-negotiable

**Always follow `linen-design-system-v3 (1).md` for any visual or layout
change.** It is the source of truth for typography, color, spacing, radii,
shadows, motion, components, and composition decisions. Read it before
touching `index.html` or `styles.css`, every time.

The short version:
- Light mode only, forever. Linen background `#F5EFE6`, tan accent `#B8895A`.
- PT Serif for display + H1 only; DM Sans for everything else.
- Sharp corners (4–8px); `--radius-xl` (16px) is reserved for sheets.
- Soft, warm-brown shadows — never pure black.
- Use design tokens only — no raw hex, px sizes, or font names outside
  `:root`. If a value isn't on the scale, round to the nearest token.
- Caps per screen: 2 font weights, 3 text colors, 2 accent surfaces, 1
  active status color.
- One `--text-display` element per screen, max one display screen per app.

Before generating any new screen or large layout change, walk the 12
composition decisions in Part I of the design system and state the answers.
After implementing, run the smell tests in §3.

## Workflow

- Local dev: open `index.html` directly, or serve the folder with any static
  server. There is no build step.
- After style or shell changes, bump the `CACHE` constant in `sw.js`.
- Don't introduce frameworks, bundlers, or dependencies — the app stays
  hand-written vanilla.
