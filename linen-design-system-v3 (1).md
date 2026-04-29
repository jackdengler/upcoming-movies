# Linen Design System — v3.0

> A personal design system for iOS PWAs. **Process first, paint second.** Read top-to-bottom before writing any code, every time.

**Philosophy:** Restraint. Editorial confidence. Warm minimalism. Sharp structure with soft surfaces. One opinionated direction, executed precisely. Every choice in this doc was made deliberately — do not deviate without a strong reason.

**Reference apps:** Claude (warmth), Robinhood (information hierarchy), Apple Human Interface (system correctness). The DNA pulled from each: typographic confidence, single accent color, soft surfaces, motion with intent, brutal hierarchy.

**Stack:** PWA on iOS. HTML/CSS/JS or React. No frameworks assumed. **Light mode only — forever.** This system will never have a dark mode. Tokens are not structured for theming because there is no theme to switch to. Build with that certainty.

**Browser floor:** iOS Safari 16.4+. This is the install base in 2026 and the version where `color-mix()`, `100dvh`, manifest-driven splash screens, and modern `:has()` selectors all work natively. Below that, gracefully degrade or block.

---

## How this document is structured

This spec has two parts, in this order:

**Part I — Composition (the process).** A 12-decision sequence that walks every screen from "what is this for" to "what's deliberately omitted," plus 30 smell tests for catching drift mid-generation. App-agnostic. This is *how* a designer thinks before any pixel is placed.

**Part II — Paint (the system).** Tokens, components, patterns, accessibility, motion, performance — everything that gives composed screens their visual identity. This is *what* a designer reaches for once the composition is decided.

Read Part I before generating any screen. Use it to answer the 12 decisions. *Then* implement using Part II's tokens and components. The order matters: composition first, paint second. Reversing them is how screens get vibe-coded.

---

## Changelog from v2.1 → v3.0

This is a major release because it changes the *shape* of the spec, not just the values.

1. **Added Part I (Composition).** Twelve sequential decisions every screen must answer before generation, plus 30 smell tests. This is the missing layer that made earlier versions produce moodboard output even when token usage was correct.
2. **Renumbered everything.** Part II (the original v2.1 spec) keeps its content but is renumbered §8 onward. References within sections updated.
3. **Five-second test merged with smell tests.** The §18 checklist from v2.1 is now consolidated into §3's smell tests, organized by category.
4. **"Decisions, not options" framing.** Where v2.1 offered tools, v3.0 makes the calls. Defaults are explicit; deviation requires a reason.
5. **Cross-references between Parts I and II.** Composition decisions in Part I reference the tokens and components in Part II that implement them. Part II's component rules cite which composition decision they serve.

---

## Changelog from v2 → v2.1 (preserved)

Small patch release. No new components, no token renames. Corrections only:

1. **Comment fix on signed amounts.** `−` (U+2212, MINUS SIGN) is correctly used in code; the inline comment incorrectly called it an en-dash. Comment now reads "U+2212 minus sign, not hyphen-minus." Same fix in §15.
2. **Contrast verified on tinted surfaces.** v2's contrast table only proved tokens against linen. v2.1 added a second table verifying status text on its matching `*-soft` background. `--color-warning` on `--color-warning-soft` was the marginal case; raised slightly to ensure pass.
3. **`.badge.neutral` flagged.** Accent text on accent-soft background is 3.0:1 — passes for non-text UI but fails for text. Badge text was bumped to `--color-text` with the soft accent staying as background.
4. **PWA meta tags updated.** Added the standard `mobile-web-app-capable` alongside the deprecated `apple-` prefixed version.
5. **Z-index gaps documented as intentional.** Gaps in the layer scale (50→90, 100→150) exist precisely so you can interpolate without inventing new tokens.
6. **Hide-balance dot count.** `.balance-hidden` now uses a fixed 6-dot mask regardless of balance length.
7. **Scroll lock caveat noted.** The fixed-position pattern loses horizontal scroll on RTL/wide layouts.
8. **File structure tension resolved.** The system is one canonical spec; the *implementation* may split across files past app #3.

---

# PART I — COMPOSITION

> This is the process layer. Walk these decisions for every screen, in order, before touching tokens or components. App-agnostic by design — the same 12 decisions apply whether you're building a banking app, a meditation app, a recipe app, or anything else.

---

## 1. The three principles every decision serves

Every decision in §2 exists to serve one of these three principles. When a decision is unclear, return to the principle.

### Principle 1 — Content outweighs chrome

The user opened the app to do something or see something. That something is *content*. Everything else — headers, navigation, branding, stats, banners — is *chrome*. Chrome supports content. Chrome never competes with content.

**Operational form:** on any primary screen, the user's content occupies at least 70% of the vertical space below the status bar. If chrome is eating more than 30%, chrome loses.

**Why this principle:** chrome inflation is the single most common failure mode in generated UI. Big serif titles, decorative eyebrows, stats grids, and warning banners stack until the actual content is below the fold. The screen looks like a magazine cover for an app instead of an app.

### Principle 2 — Restraint reads as quality

Premium-feeling UI is built from *less, executed precisely*, not *more, executed decoratively*. Every element on the screen must justify itself. The instinct to "make it feel designed by adding more" is exactly backwards.

**Operational form:** when in doubt between two options, pick the one with fewer elements, smaller type, less color, and less decoration. Subtract before you add.

**Why this principle:** generation tends toward maximalism — every available token gets used, every section gets a header, every list gets a card wrapper. Real designers spend most of their time *removing* things. This principle forces the same discipline.

### Principle 3 — Decisions compound

Every choice on a screen affects every other choice. Type size affects spacing. Spacing affects density. Density affects how many items fit. How many items fit affects whether you need search. Whether you need search affects header height. Header height affects content ratio.

**Operational form:** make decisions in the order given in §2. Don't pick a type size before you've picked a density tier. Don't pick a header layout before you've picked the primary action's location.

**Why this principle:** vibe-coded output looks vibe-coded because the decisions were made in parallel — type, color, layout, all chosen simultaneously without one constraining the next. Sequential decisions produce coherent screens. Parallel decisions produce moodboards.

---

## 2. The 12 decisions, in order

Walk these in order for every screen. Each decision has:
- **The question** — the call you're making
- **The options** — the valid answers
- **The picker** — what condition selects between options
- **Worked examples** — three different apps, three different answers
- **The failure mode** — what breaks if you skip or guess this decision

The worked examples deliberately use *different* apps each time so the *decision* generalizes, not the example. Don't pattern-match the domain; pattern-match the reasoning.

### Decision 1 — What is the one thing this screen is for?

**The question:** in one sentence, what does the user accomplish on this screen?

**The options:**
- *See* (a list, a number, a status, a feed)
- *Do* (an action, a transaction, a creation)
- *Decide* (between options, paths, items)
- *Settle in* (welcome, onboard, complete)

**The picker:** ask what the user came for, not what the app wants to show. If you can't answer in one sentence, the screen is doing too much — split it.

**Worked examples:**
- *Banking app, account screen.* The one thing: see the current balance and recent transactions. (See.) Not: see balance, transfer money, pay bills, view statements, contact support. Those are separate screens.
- *Meditation app, session screen.* The one thing: start a meditation. (Do.) Not: browse meditations, see streak, configure preferences. The session screen does one thing — starts the session.
- *Recipe app, recipe detail.* The one thing: cook this recipe. (Do, with See as support.) Not: rate, share, save, browse similar. Those live in secondary affordances.

**Failure mode:** every other decision in this list assumes you've answered Decision 1. Skip it and you'll add elements that serve different one-things and the screen will feel scattered. The user won't be able to name what the screen is for, and that ambiguity will read as bad design even if every individual element is well-styled.

### Decision 2 — What is the user's content on this screen?

**The question:** what specific element or elements *are* the content the user came to see or act on?

**The options:** name them explicitly. Usually 1–3 things.

**The picker:** content is what would be missing if the app had no data yet. Chrome would still be there in the empty state. Content wouldn't.

**Worked examples:**
- *Banking app, account screen.* Content: the balance number, the transaction list. Chrome: the account name, the navigation, the time greeting.
- *Meditation app, session screen.* Content: the meditation title, the start button, the duration. Chrome: the back arrow, the settings icon, the breath illustration (decorative).
- *Recipe app, recipe detail.* Content: the recipe title, the ingredient list, the steps. Chrome: the back arrow, the share icon, the rating stars (chrome because they're meta about the content, not the content itself).

**Failure mode:** if you can't distinguish content from chrome, you'll size them the same. The result is a screen where the app's branding visually outweighs the user's data. This is the single most common reason generated screens look amateurish — the app name is bigger than the bank balance.

### Decision 3 — What density tier matches this screen?

**The question:** how tightly should information be packed?

**The options:**
- *Editorial* — generous whitespace, magazine-like, content gets room to breathe. Use for: onboarding, empty states, dashboards with one hero metric, completion screens, settings landings.
- *Working* — compact rows, scannable, optimized for repeated interaction. Use for: lists, feeds, inboxes, transaction histories, search results, task views.
- *Dense* — minimum spacing, maximum information per screen. Use for: tables, admin views, technical tools, data-heavy comparisons.

**The picker:** how many items will the user scan? 1–3 → Editorial. 5–30 → Working. 30+ → Dense. Cross-check with Decision 1: *See* and *Do* with single targets → Editorial; *See* with collections → Working or Dense.

**Worked examples:**
- *Banking app, account screen.* The balance is one hero number — Editorial treatment for the balance. The transactions below are Working tier — compact rows for scanning.
- *Meditation app, session screen.* One thing to do, Editorial all the way. Lots of breathing room around the start button.
- *Recipe app, recipe detail.* The title is Editorial. The ingredients and steps are Working — tight enough to scan while cooking.

**Failure mode:** Editorial density on a working screen produces the chrome-inflation problem — a 32px serif title and a stats row eating the viewport while the actual list is below the fold. Working density on an Editorial screen produces a meditation app that feels like a spreadsheet.

A single screen can mix tiers (Editorial header, Working list) — but the *primary tier* is one of the three.

**Implementation note:** the spacing tokens that implement these tiers are in §11 (`--space-*`). Editorial uses `--space-5`+ between blocks; Working uses `--space-3`; Dense uses `--space-2`.

### Decision 4 — What is the type hierarchy ceiling?

**The question:** how big is the largest type element on this screen allowed to be?

**The options:** measured in steps down from `--text-display` (the largest size in §10's type scale).
- `--text-display` (32px) — reserved for screens where the *content itself* needs to be hero-sized (a balance, a hero greeting, a single meditation title).
- `--text-h1` (26px) — title screens for editorial moments.
- `--text-h2` (20px) — default for working screens. Most lists, most feeds, most utility screens cap here.
- `--text-h3` (17px) — section headers within a screen, or titles on dense screens.

**The picker:** the type ceiling matches the content's importance, not the app's desire to feel premium. If the largest element on the screen *is* the content (a balance, a hero greeting), use `--text-display`. If the largest element is the *title* of a list of content, drop to `--text-h2`.

**Worked examples:**
- *Banking app, account screen.* The balance gets `--text-display` — it *is* the content. The screen title "Checking" gets `--text-body` size, in a header bar.
- *Meditation app, session screen.* The meditation title gets `--text-display` — it's the content. The "Today's session" eyebrow above it is `--text-small`.
- *Recipe app, recipe detail.* The recipe name gets `--text-h1` (content, but not as singular as a balance). Section headers ("Ingredients", "Steps") get `--text-h3`.

**Failure mode:** `--text-display` on every screen is the chrome inflation pattern. It's how every screen ends up looking like an editorial cover.

**The hard rule:** **at most one screen per app uses `--text-display` for its title.** Usually the home/dashboard. Every other screen drops the ceiling to `--text-h1` or `--text-h2`. The "one Display per screen" rule from v2.1 is sharpened: now also "one Display *screen* per app."

### Decision 5 — Where does the primary action live?

**The question:** if the user does *one* thing on this screen, where do they tap?

**The options:**
- *Inline in the header* — small button (`.btn-sm`), secondary styling. For low-frequency actions on a See screen.
- *Bottom-right floating* — circular FAB, icon or icon+label. For frequent actions on a See screen (compose, add).
- *Bottom bar full-width* — `.btn-primary` styling, anchored. For Do screens where the action *is* the screen's purpose.
- *In the content flow* — the action is a button within the layout. For Decide screens where the action depends on what's above.

**The picker:** match action placement to screen archetype.
- See screen with frequent action → bottom-right FAB.
- See screen with rare action → inline header button (`.btn-sm` with `.btn-secondary`).
- Do screen → bottom bar full-width with `.btn-primary`.
- Decide screen → in-flow.

**Worked examples:**
- *Banking app, account screen* (See). Frequent action is "Transfer." → bottom-right FAB.
- *Meditation app, session screen* (Do). Action is "Begin." → bottom bar full-width, `.btn-primary`.
- *Recipe app, recipe detail* (Do, with See). Action is "Start cooking." → bottom bar. The header has secondary actions (share, save) at small size, inline.

**Failure mode:** large primary CTAs in the upper-right of the header. This eats header space, competes with the title, and puts the action in the part of the screen the user is *least* likely to tap by reach. Primary actions go to the bottom of the phone, not the top.

### Decision 6 — How does the user navigate within or away from this screen?

**The question:** what navigation does this screen need, and does it earn it?

**The options:**
- *None* — modal screens, full-takeover flows, the app's home.
- *Back only* — detail views, drill-downs.
- *Back + secondary actions* — detail views with share/save/etc.
- *Tabs (within-screen)* — splitting one screen into 2–4 filtered views. Uses `.tabs` from §16.5.
- *Tab bar (app-level)* — bottom navigation, persistent across screens.

**The picker:** within-screen tabs only earn their place when the user *frequently* switches between filtered views of the same data. If they tap a tab once and stay there, the tabs are noise — make them filters or settings instead.

**Worked examples:**
- *Banking app, account screen.* App-level tab bar at bottom. No within-screen tabs — the transactions are one list, not multiple filtered views.
- *Meditation app, session screen.* Back arrow only. The screen is a focused take-over.
- *Recipe app, recipe detail.* Back + share/save inline. No tabs — a recipe isn't multiple views of itself.

**Failure mode:** stacking app-level tab bar + within-screen tabs + filter chips + search on the same screen. Each is a navigation mechanism. Three at once means the designer couldn't decide. **Pick one filtering mechanism per screen.**

### Decision 7 — What status or feedback does the screen need to show?

**The question:** what state changes does the user need to be aware of, and how much weight does each deserve?

**The options:**
- *Nothing* — steady state, no special status. Most screens, most of the time.
- *Inline indicator* — a badge, a dot, a color treatment on the affected item. For per-item status. Use the status matrix in §9.
- *Banner* — a full-width strip above content. For screen-level conditions that need attention.
- *Modal/sheet* — for status that blocks further interaction. Use `.sheet` from §16.8.

**The picker:** the *least intrusive option that surfaces the status sufficiently*. A single overdue task is an inline badge on that task, not a banner. A network outage affecting the whole screen is a banner. A confirmation that requires user action is a sheet.

**Worked examples:**
- *Banking app, account screen.* A pending transfer is an inline badge on that transaction. A frozen account is a banner. A required identity verification is a sheet.
- *Meditation app, session screen.* No status needed in steady state. Mid-session pause is inline. Expired subscription is a banner on entry.
- *Recipe app, recipe detail.* No status in steady state. Missing ingredients is an inline note. Recipe removed by author is a banner.

**Failure mode:** status escalation — putting screen-level banners on per-item conditions. A list of 50 tasks where one is overdue should not get a banner saying "1 task is overdue." That's redundant with the inline badge on the task itself.

**Critical pairing:** **banners and stats rows are mutually exclusive.** Stats are for the steady state ("you have 5 active tasks"). Banners are for the exceptional state ("1 task needs attention"). They don't stack. If the exceptional state is showing, the stats row is hidden or absorbed into it.

### Decision 8 — What's the empty state?

**The question:** what does this screen look like when the user has no data yet?

**The options:**
- *Editorial empty state* — full-screen treatment, illustration optional, one sentence of copy, one CTA. For first-run, primary screens.
- *Inline empty state* — short message in the content area, no illustration, sometimes a secondary CTA. For sub-screens or filtered states with no results.
- *Skeleton* — for loading states that resolve quickly. Not a true empty state.

**The picker:** is the user's *natural state* on this screen empty (first run, just signed up) or is empty *exceptional* (they cleared everything)? Natural empty states deserve Editorial treatment. Exceptional empty states get inline treatment.

**Worked examples:**
- *Banking app, account screen.* Empty is exceptional. Inline message: "No transactions in this period."
- *Meditation app, library.* Empty is natural for first run. Editorial: "Your library is empty. Browse meditations to add your first."
- *Recipe app, saved recipes.* Empty is natural for first run. Editorial: "Recipes you save will appear here."

**Failure mode:** skipping the empty state entirely. The screen looks broken on first run. Or: editorial empty states on exceptional emptiness, which over-dramatizes a routine condition.

### Decision 9 — What's the loading state?

**The question:** what does the user see in the gap between request and response?

**The options:**
- *Nothing* — for sub-100ms responses (cached, local).
- *Skeleton* — for 100ms–2s responses where the layout is known. Uses `.skeleton` from §17. Same shape as the eventual content.
- *Spinner* — for indeterminate operations or actions that complete the screen. Uses `.btn-loading` for in-button cases.
- *Progress indicator* — for operations with measurable progress.

**The picker:** match the loading affordance to the operation. Use skeletons for content that has a known layout. Use spinners for actions ("submitting...") and indeterminate operations. Never both at once.

**Worked examples:**
- *Banking app, account screen.* Skeleton rows for the transaction list while it loads. The balance loads with a skeleton number-shape.
- *Meditation app, session screen.* No loading state — it's local. The session starts instantly.
- *Recipe app, recipe detail.* Skeleton for the title, image, and ingredients during fetch.

**Failure mode:** spinners over content (full-screen loading overlay) when a skeleton would maintain layout continuity. The screen "jumps" from spinner to content, which feels less designed than a skeleton smoothly resolving.

### Decision 10 — How much chrome does the screen earn?

**The question:** of the optional chrome elements, which are *necessary* for this screen and which are *additive*?

**The options:** for each chrome element below, decide *include* or *omit*.
- Eyebrow (small italic-serif label above title — see §10)
- Greeting/time-of-day text
- Stats row (counts, summaries)
- Search bar
- Filter chips
- Tab strip (within-screen)
- Section headers
- Footer/legal text

**The picker:** apply the 70/30 rule from Principle 1. Sketch the screen mentally. If user content takes less than 70% of the viewport, start removing chrome — eyebrow first, stats next, then anything redundant.

**Worked examples:**
- *Banking app, account screen.* Include: title, balance (content), transaction list (content). Omit: eyebrow, greeting, stats row (the balance *is* the stat), filter chips by default. The transaction list is the content; chrome stays minimal.
- *Meditation app, session screen.* Include: small back arrow, title (content), duration (content), start button (content). Omit: everything else. This is a focus screen.
- *Recipe app, recipe detail.* Include: back, title (content), image (content), ingredients (content), steps (content), section headers ("Ingredients", "Steps"). Omit: eyebrow, stats, search, tabs.

**Failure mode:** stacking eyebrow + Display title + stats row + banner + tabs + search. Each individually is fine; together they consume the viewport before content begins. The fix is per-element justification: every chrome element must answer "what would break if I removed this?" If the answer is "nothing critical," remove it.

### Decision 11 — How many colors and weights does this screen use?

**The question:** how much visual differentiation is on screen?

**The options:** count them explicitly.
- *Text colors* — `--color-text`, `--color-text-dim`, `--color-text-faint`, `--color-accent`. **Cap: 3 on a single screen.**
- *Font weights* — 400, 500, 600, 700. **Cap: 2 on a single screen.**
- *Accent surfaces* — buttons, highlights, badges using `--color-accent`. **Cap: 2 per screen.**
- *Status colors* — success, warning, error, pending. **Cap: 1 status active at a time.**

**The picker:** when the count exceeds the cap, something is wrong. Either the screen is doing too much (split it) or differentiation is being used decoratively (remove it).

**Worked examples:**
- *Banking app, account screen.* Colors: text primary (transactions), text dim (dates), accent (balance positive sign or transfer button). Weights: 400 (most text), 700 (balance, amounts). Two weights, three text colors, one accent surface. Within caps.
- *Meditation app, session screen.* Colors: text primary (title), text dim (duration). Weights: 400, 700. Two of each. Disciplined.
- *Recipe app, recipe detail.* Colors: text primary, text dim (metadata), accent (start button). Weights: 400, 600 (section headers). Within caps.

**Failure mode:** every element on the screen styled differently, each justified individually. The cumulative effect is visual noise. The fix is the cap — if you're over, remove the least essential differentiation first.

### Decision 12 — What does this screen *not* have that a similar screen elsewhere might?

**The question:** what's the most important *omission*?

**The options:** name 1–3 things deliberately left out.

**The picker:** every well-designed screen has visible omissions. The screen's identity is partly defined by what it refuses to include. Naming the omissions explicitly forces the discipline.

**Worked examples:**
- *Banking app, account screen.* Deliberately omits: a "promotions" carousel, a "you might also like" section, a "rate this app" prompt. The screen refuses to be a marketing surface.
- *Meditation app, session screen.* Deliberately omits: social sharing, streak counter, achievement notifications. The screen refuses to gamify the moment.
- *Recipe app, recipe detail.* Deliberately omits: ads, "people also viewed," comments above the ingredients. The screen refuses to delay the user from cooking.

**Failure mode:** screens that include "everything that might be useful" without curation. The result is a screen with no identity — it's trying to serve every possible user need on one surface. Pro design is partly about *what you refuse to put on the screen*.

---

## 3. Smell tests — catch yourself mid-generation

These are calibration heuristics. If any are true of a screen you're building, stop and revise. Organized by category for quick scanning. Many of these are the v2.1 "five-second test" expanded into a full diagnostic surface.

### Type and weight smells
1. More than 2 font weights on a single screen → one of them is decorative; remove it.
2. More than 3 text colors on a single screen → hierarchy is being faked with color instead of size.
3. The largest text on the screen is the app's name → content is losing to chrome.
4. Italic, bold, and underlined text all on the same screen → emphasis has been over-applied; nothing reads as emphasized anymore.
5. Type sizes that aren't on the `--text-*` scale → vibe pixels; round to a token.

### Layout and density smells
6. The first content item is below the fold on a 667pt viewport → header is too tall.
7. More than 5 distinct sections above the fold → screen is doing too much.
8. Symmetric padding everywhere → no rhythm; vary spacing intentionally to group related items.
9. Cards inside cards inside cards → nesting is replacing hierarchy; flatten.
10. A list item taller than 2 lines of body text → row is over-stuffed; truncate with ellipsis or split into a detail view.

### Color and accent smells
11. The accent color appears more than twice on one screen → accent is becoming wallpaper.
12. Status colors used decoratively (not for status) → the status palette is now meaningless.
13. Background tints on more than one element type → tints are competing instead of grouping.
14. A banner and a stats row visible at the same time → redundant; the banner replaces stats (Decision 7).

### Composition smells
15. The user can't name the primary action in 2 seconds → the CTA is buried or unclear.
16. Two equally-weighted actions in the header → no primary; pick one.
17. Multiple filtering mechanisms (tabs + search + chips) on one screen → designer indecision; pick one.
18. The empty state wasn't designed → the empty state matters more than the populated state for first-run impressions (Decision 8).
19. The screen has a "promotions" or "you might like" section → marketing surface masquerading as utility.
20. You added a section because the screen "felt empty" → empty is allowed; whitespace is a design choice.

### Behavior smells
21. The primary CTA is in the upper-right of the header → put it bottom-right or in a bottom bar (Decision 5).
22. The back affordance and the close affordance are both present → pick one based on flow type.
23. Tab bar items use icons-only without labels → labels are not optional; mystery icons fail.
24. Touch targets smaller than 44pt → fails usability before it fails aesthetics.
25. Modal stacked on modal → over-nested flows; restructure.

### Restraint smells
26. You used `--text-display` because the screen "needed presence" → presence is earned through restraint, not type size (Decision 4).
27. You added an eyebrow because the title "felt lonely" → titles are allowed to stand alone.
28. You added an illustration because the screen "felt empty" → empty is a design choice; if it's wrong, it's the layout, not the missing illustration.
29. You wrapped flat content in a card "for visual interest" → cards are for grouping, not decoration (see §16.6).
30. You can't articulate what each element on the screen is *for* → it shouldn't be there.

---

## 4. Decisions, not options

The rest of this spec offers tools. This section makes the calls. When in doubt, follow these defaults — deviation requires a reason.

### Type decisions

- **Default screen title:** `--text-h2`, DM Sans, weight 600. Not Display. Not serif.
- **Display serif (`--text-display`):** reserved for dashboard greeting, detail-view subject, empty state hero. Three places, app-wide.
- **Eyebrow (italic lowercase serif):** dashboard and editorial screens only. Never on list views, forms, or detail views.

### Layout decisions

- **Header height on list views:** ≤96pt including safe-area inset. If you can't fit the title and primary action in 96pt, the title is too big or the action is in the wrong place.
- **Stats vs. banner:** mutually exclusive. Status conditions replace stats; they don't stack.
- **Filtering mechanism:** one per screen. Tabs OR search OR filter chips. Not multiple.
- **Primary CTA placement on list views:** bottom-right FAB or bottom-bar. Not top-right header button.

### Density decisions

- **List rows by default:** Working tier. `--space-3` vertical padding. Two lines of content max per row before truncating with ellipsis.
- **Card vs. flat list:** flat list by default. Cards only when items have meaningfully different shapes or need visual grouping. A list of homogeneous items is a flat list, not a stack of cards.
- **Whitespace above the first content row:** `--space-4`, not `--space-5` or `--space-6`. The list is the point of the screen; don't push it down.

### Color decisions

- **Status color on a list row:** badge or text color, not background tint. Tinting the whole row reads as selection, not status.
- **Accent color usage per screen:** maximum two surfaces. The primary CTA, plus *one* accent moment.

### When you don't know which to pick

Default to the **less decorative** option. Less type, less color, less chrome, smaller sizes. Editorial confidence is built from restraint, not maximalism.

---

## 5. The decision walkthrough — a worked example

Here's the full 12-decision walk for one screen, applied to a **fitness app's workout summary screen** (shown after a workout completes). This is a fourth domain, deliberately not used in §2's examples, so the *process* generalizes rather than the *examples*.

**Decision 1 — One thing:** Show the user what they just accomplished. (See, with a hint of Settle in.)

**Decision 2 — Content:** The workout name, the duration, the calories, the exertion summary. The chrome is the back arrow, the share button, the date.

**Decision 3 — Density:** Editorial. This is a moment screen — they finished something. Generous whitespace. One hero metric.

**Decision 4 — Type ceiling:** `--text-display`, used for the *result* (e.g., "42 minutes" or "Strong session"). The workout name itself is `--text-h2`. The Display element is the *outcome*, not the title.

**Decision 5 — Primary action:** "Done" / "Save and close" — bottom bar, full-width, `.btn-primary`. The screen is a Do screen masquerading as a See screen; the user is *completing* a flow.

**Decision 6 — Navigation:** Close affordance only (X in upper-left). No back. No tabs, no app-level nav.

**Decision 7 — Status:** None in steady state. If a personal record was hit, an inline badge ("New PR") on the relevant metric. No banner.

**Decision 8 — Empty state:** N/A — this screen never appears empty.

**Decision 9 — Loading state:** N/A — data is local, transition is instant.

**Decision 10 — Chrome budget:** Include: close affordance, hero result, workout name, key metrics (3 max), share button, primary CTA. Omit: eyebrow, stats row (the metrics *are* the stats), search, tabs, social feed, "share to friends" prompt, achievements panel, "next workout" suggestion. The screen refuses to monetize the moment.

**Decision 11 — Colors and weights:** Two text colors (primary for metrics, dim for labels), two weights (400 for labels, 700 for metric values). One accent surface (the primary CTA). Within caps.

**Decision 12 — Deliberate omissions:** No social sharing in the primary view. No leaderboard. No "next workout" upsell. The screen does one thing — celebrate the completion — and refuses to pivot the user toward another action.

The screen this produces: a clean, focused moment with the user's accomplishment as the visual hero, one clear way out, and zero distractions. It feels designed because every element earned its place through Decision 10, and the decisions were sequenced so that earlier choices constrained later ones.

The same 12 decisions, applied to a recipe detail or a banking dashboard, produce different but equally-coherent screens. That's the point — the *process* is the spec.

---

## 6. Process: how to use Part I when generating a screen

When asked to build any screen:

1. **Walk decisions 1–12 in §2 in order.** Don't write any markup until all 12 are answered explicitly.
2. **State the answers in the response.** Make the decisions visible so they can be reviewed. ("Decision 1: see screen for transaction history. Decision 2: content is the list of transactions. Decision 3: Working tier...") This is not optional — implicit decisions become vibes.
3. **Generate the screen using Part II's tokens and components.** Composition in Part I; paint in Part II.
4. **Run the smell tests in §3.** Any failures, revise before presenting.
5. **Name the deliberate omissions** (Decision 12). Surface them so the user can confirm or push back.

If asked for a screen and any of the 12 decisions can't be answered from the request, **ask one clarifying question** — usually it's Decision 1 (what is the one thing?) or Decision 5 (where does the primary action live?). Don't guess.

---

## 7. The handoff to Part II

You've made the 12 decisions. You know:
- What the screen is for
- What's content and what's chrome
- How dense it should be
- The type ceiling
- Where the primary action lives
- The navigation approach
- The status approach
- The empty and loading states
- What chrome to include
- Color and weight budget
- What to deliberately omit

Now reach for Part II. Pick the tokens that match the density tier. Use the components that match the action placements. Apply the type scale at the ceiling you chose. Every choice in Part II should be a *consequence* of a Part I decision, never a parallel or independent choice.

Part II starts at §8.

---

# PART II — PAINT (THE SYSTEM)

> Tokens, components, patterns, accessibility, motion, performance. The visual identity that gives composed screens their look. Read this before implementing the choices you made in Part I.

---

## 8. The one rule that breaks everything if ignored

**Use tokens. Never raw values.**

Every color, font size, spacing, corner radius, shadow, duration, easing, z-index, and breakpoint in any code you write must reference a CSS custom property defined in this doc — never a hardcoded number, hex code, or font name.

This rule is non-negotiable because it's the only thing keeping every PWA you ship feeling like it came from the same studio. Tokens make a system; raw values make a one-off. The moment you write `padding: 14px` instead of `padding: var(--space-3)`, the system starts to drift.

### Always

```css
/* ✅ Correct — references the system */
.card {
  padding: var(--space-4);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: var(--text-body);
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-fast) var(--ease-out);
  z-index: var(--z-base);
}
```

### Never

```css
/* ❌ Wrong — hardcoded values, even if they happen to match */
.card {
  padding: 16px;                    /* should be var(--space-4) */
  background: #FFFCF7;              /* should be var(--color-surface) */
  border-radius: 6px;               /* should be var(--radius-md) */
  color: #2A2520;                   /* should be var(--color-text) */
  font-family: 'DM Sans', sans-serif; /* should be var(--font-body) */
  font-size: 15px;                  /* should be var(--text-body) */
  box-shadow: 0 1px 2px rgba(60,40,20,0.06); /* should be var(--shadow-sm) */
  transition: transform 180ms cubic-bezier(0.2,0,0,1); /* should use --duration-fast / --ease-out */
}
```

### Rules

1. **If a value isn't on the scale, it doesn't belong on the screen.** Round to the nearest token.
2. **No new colors.** Derive from existing tokens via `color-mix()`, alpha modifiers, or — preferably — use one of the pre-defined status variants in §10. The palette is closed.
3. **No new font sizes.** The 7-step type scale is the entire vocabulary.
4. **No new corner radii.** Five values cover everything.
5. **No new z-indexes.** Use the layer scale in §10. The gaps in the scale (50→90, 100→150) are intentional — interpolate within them using `calc(var(--z-toast) + 5)` if you absolutely need an in-between layer. If you find yourself wanting a layer outside the documented range, the design is wrong, not the scale.
6. **Inline styles must also use tokens.** When applying styles inline (rare, but happens in React), reference CSS variables:
   ```jsx
   /* ✅ */ <div style={{ padding: 'var(--space-4)' }}>
   /* ❌ */ <div style={{ padding: '16px' }}>
   ```
7. **Tailwind / utility classes:** if used, configure the theme to map to these tokens. Do not use Tailwind defaults.
8. **The exceptions** (the only places raw values are allowed):
   - Inside the `:root` block where the tokens themselves are defined.
   - SVG `viewBox`, `width`, `height` attributes for icons.
   - `calc()` expressions where one operand is a token.
   - `@keyframes` percentages.
   - Hit-area `::before` overlays where a 44pt minimum forces a non-token size.

If you ever feel the urge to write a raw value, stop and ask: *which token should this be?*

---

## 9. Brand essentials

| | |
|---|---|
| **Display typeface** | PT Serif (Google Fonts) — for headings, hero balances, italic accents, eyebrows, footnote markers |
| **Body typeface** | DM Sans (Google Fonts) — for all UI text, body copy, labels, numbers |
| **Background** | Linen `#F5EFE6` |
| **Accent** | Tan `#B8895A` |
| **Voice** | Confident, direct, second-person, sentence case, plain-spoken |
| **Density** | Compact — more information per screen, tighter rows |
| **Corners** | Sharp — 4–8px max radius |
| **Motion** | Crisp — 180ms, `cubic-bezier(0.2,0,0,1)` |
| **Shadows** | Soft — present but never heavy |
| **Mode** | Light only. Forever. |

---

## 10. Design tokens (CSS custom properties)

Drop this in your root stylesheet. Every color, font, spacing, and motion value below comes from these.

```css
:root {
  /* ============================================================
     COLOR — light mode only, no theme wrapper needed
     ============================================================ */

  /* Surfaces */
  --color-bg:               #F5EFE6;          /* linen — page background */
  --color-surface:          #FFFCF7;          /* warm white — cards, inputs, sheets */

  /* Text — all values verified for WCAG AA on --color-bg */
  --color-text:             #2A2520;          /* primary — 9.8:1 ✓ */
  --color-text-dim:         #6F665B;          /* secondary — 5.1:1 ✓ (darkened from v1) */
  --color-text-faint:       #877E72;          /* tertiary — 3.6:1, ≥18px text only */

  /* Borders */
  --color-border:           rgba(60,40,20,0.08);
  --color-border-strong:    rgba(60,40,20,0.16);

  /* Accent */
  --color-accent:           #B8895A;          /* tan — primary CTA, links, focus */
  --color-accent-dark:      #9C7148;          /* gradient end (toggle, future use) */
  --color-accent-text:      #FFFFFF;          /* text on accent backgrounds — 4.7:1 ✓ */
  --color-accent-soft:      rgba(184,137,90,0.14);   /* tinted backgrounds */
  --color-accent-border:    rgba(184,137,90,0.28);   /* visible edges on tints */

  /* ---------- Status matrix ---------- */
  /* Each status has: solid (text/border on tints), soft (background), border, text-on-bg */

  --color-success:          #3F6B3F;          /* solid — 5.4:1 ✓ */
  --color-success-soft:     rgba(63,107,63,0.10);
  --color-success-border:   rgba(63,107,63,0.22);
  --color-success-text:     #FFFFFF;          /* text on solid */

  --color-warning:          #A6741F;          /* solid — 5.0:1 ✓ on linen, 4.6:1 ✓ on warning-soft (darkened in v2.1) */
  --color-warning-soft:     rgba(166,116,31,0.12);
  --color-warning-border:   rgba(166,116,31,0.26);
  --color-warning-text:     #FFFFFF;

  --color-error:            #8C3A2E;          /* solid — 6.4:1 ✓ */
  --color-error-soft:       rgba(140,58,46,0.10);
  --color-error-border:     rgba(140,58,46,0.24);
  --color-error-text:       #FFFFFF;

  --color-pending:          #8A6F3D;          /* muted ochre — distinct from warning, italic by convention */
  --color-pending-soft:     rgba(138,111,61,0.10);
  --color-pending-border:   rgba(138,111,61,0.22);

  /* ---------- Money ---------- */
  --color-positive:         #3F6B3F;          /* income, credits */
  --color-negative:         #6B4423;          /* outflows — deeper warm brown, NOT red */

  /* ---------- Focus ring ---------- */
  /* Stronger than v1 to meet WCAG 2.2 focus contrast (3:1 against any adjacent color) */
  --color-focus-ring:       rgba(184,137,90,0.55);

  /* ============================================================
     TYPE
     ============================================================ */
  --font-display: 'PT Serif', ui-serif, Georgia, serif;
  --font-body:    'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono:    'JetBrains Mono', ui-monospace, monospace;

  /* type scale — letter-spacing recalibrated for serif at display sizes */
  --text-display: 32px;     /* lh 1.05, ls -0.005em, weight 700, serif */
  --text-h1:      26px;     /* lh 1.15, ls -0.01em,  weight 700, serif */
  --text-h2:      20px;     /* lh 1.25, ls -0.015em, weight 600, body */
  --text-h3:      17px;     /* lh 1.30, ls -0.01em,  weight 600, body */
  --text-body:    15px;     /* lh 1.50, weight 400, body */
  --text-small:   13px;     /* lh 1.45, weight 400, body */
  --text-micro:   11px;     /* lh 1.30, weight 600, body — uppercase variant in component classes */

  /* Reading width caps — applied to prose containers, not individual elements */
  --measure-display: 28ch;  /* forces good display headline rebalancing */
  --measure-body:    62ch;  /* prevents edge-to-edge body text */

  /* ============================================================
     SPACE — 4-base, 6 stops
     ============================================================ */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  /* ============================================================
     RADIUS — Sharp
     ============================================================ */
  --radius-sm:   4px;
  --radius-md:   6px;
  --radius-lg:   8px;
  --radius-xl:   16px;       /* sheets only */
  --radius-pill: 100px;

  /* ============================================================
     SHADOW — Soft, warm-brown not pure black
     ============================================================ */
  --shadow-sm:  0 1px 2px rgba(60,40,20,0.06);
  --shadow-md:  0 1px 3px rgba(60,40,20,0.06), 0 4px 12px rgba(60,40,20,0.05);
  --shadow-lg:  0 4px 8px rgba(60,40,20,0.08), 0 12px 28px rgba(60,40,20,0.08);
  --shadow-xl:  0 8px 16px rgba(60,40,20,0.10), 0 24px 48px rgba(60,40,20,0.12);
  --shadow-up:  0 -8px 16px rgba(60,40,20,0.04), 0 -20px 40px rgba(60,40,20,0.06); /* sheets */

  /* ============================================================
     MOTION — Crisp
     ============================================================ */
  --duration-fast:    180ms;
  --duration-normal:  220ms;
  --duration-slow:    300ms;
  --ease-out:         cubic-bezier(0.2, 0, 0, 1);
  --ease-in-out:      cubic-bezier(0.65, 0, 0.35, 1);
  --press-scale:      0.97;

  /* ============================================================
     LAYERS (z-index) — explicit scale
     ============================================================ */
  --z-base:        1;
  --z-elevated:    10;     /* cards lifting on press */
  --z-tabbar:      50;
  --z-toast:       90;
  --z-scrim:       99;     /* backdrop behind sheets/modals */
  --z-sheet:       100;
  --z-popover:     150;    /* tooltips, dropdowns */
  --z-modal:       200;    /* full-screen modals */

  /* ============================================================
     ICONS — explicit sizes
     ============================================================ */
  --icon-xs:  12px;        /* helper text inline icons */
  --icon-sm:  16px;        /* badge, toast */
  --icon-md:  20px;        /* default UI */
  --icon-lg:  22px;        /* tab bar */
  --icon-xl:  24px;        /* prominent action icons */

  /* ============================================================
     BREAKPOINTS — small phones to tablets, used in @container/@media
     ============================================================ */
  /* CSS variables can't be used inside @media; these are documentation. */
  /* --bp-sm: 375px;   small phones (SE) */
  /* --bp-md: 414px;   standard phones */
  /* --bp-lg: 430px;   Pro Max */
  /* --bp-xl: 768px;   tablet */
}

/* ============================================================
   APP-LIKE BEHAVIORS — apply to UI chrome, NOT body text
   ============================================================ */
html {
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
}
button, .ui-chrome, [role="button"] {
  -webkit-user-select: none;
  user-select: none;
}
p, h1, h2, h3, h4, .text-content {
  -webkit-user-select: text;
  user-select: text;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: var(--text-body);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  /* honors iOS Dynamic Type baseline; see §21 for full Dynamic Type stance */
}
```

### When to use each color

- `--color-bg` — page background. Linen.
- `--color-surface` — anything that sits on the page: cards, inputs, list rows, sheets, toasts.
- `--color-text` — primary copy.
- `--color-text-dim` — secondary copy at any size. Now AA-compliant for body sizes.
- `--color-text-faint` — large captions only (≥18px). Do not use on `--text-small` or `--text-micro`.
- `--color-accent` — primary CTAs, active states, links, focus rings. One accent moment per screen.
- `--color-accent-soft` — tinted backgrounds for icon containers, segmented control tracks.
- Status colors (success/warning/error/pending) — only for status. Use the full matrix (solid/soft/border) per the table.
- Money colors (`positive`/`negative`) — only on signed amounts.

### Status color matrix — pick the right variant

| Use case | Variant | Example |
|---|---|---|
| Solid filled button (e.g., destructive, success state) | `--color-{status}` + `--color-{status}-text` | `.btn-destructive` |
| Tinted background banner | `--color-{status}-soft` background, `--color-{status}` text, `--color-{status}-border` border | `.banner.error` |
| Badge / pill | `--color-{status}-soft` background, `--color-{status}` text | `.badge.success` |
| Inline icon | `--color-{status}` | toast checkmark |
| Helper text under input | `--color-{status}` | error helper |

If you need a status color and it's not in this table, you're inventing a pattern — re-check whether an existing one fits.

---

## 11. Typography rules

### The ramp

| Token | Size | Family | Weight | Line-height | Letter-spacing | Use for |
|---|---|---|---|---|---|---|
| `--text-display` | 32px | PT Serif | 700 | 1.05 | -0.005em | Hero balance, main page title (one per screen max) |
| `--text-h1` | 26px | PT Serif | 700 | 1.15 | -0.01em | Section headers, sheet titles |
| `--text-h2` | 20px | DM Sans | 600 | 1.25 | -0.015em | Card titles, list group labels |
| `--text-h3` | 17px | DM Sans | 600 | 1.30 | -0.01em | Sub-headers, form section titles |
| `--text-body` | 15px | DM Sans | 400 | 1.50 | 0 | Body copy, list items, default |
| `--text-small` | 13px | DM Sans | 400 | 1.45 | 0 | Secondary info, meta, helper text |
| `--text-micro` | 11px | DM Sans | 600 | 1.30 | 0.10em | UPPERCASE eyebrows (deprecated; see below), labels |

### Hard rules

- **Display & H1 use PT Serif.** Everything else uses DM Sans.
- **Letter-spacing on serif headings is loose, not tight.** PT Serif at 32px wants `-0.005em` (almost zero). Tight tracking is for geometric sans, not transitional serif. The values above are calibrated — don't override.
- **Line length is capped on prose.** Apply `max-width: var(--measure-body)` (62ch) to body containers and `max-width: var(--measure-display)` (28ch) to display headings. Without these, headings on Pro Max wrap awkwardly and body runs feel like a wall.
- **Numbers use `font-variant-numeric: tabular-nums`** anywhere they stack vertically.
- **Currency in hero balance:** see §18.
- **One Display per screen.**
- **Italics in body copy are allowed** for titles, foreign words, emphasis. The previous "no italics" rule was too strict. What is *not* allowed: italic display serif inside body copy (it competes with hierarchy).

### Eyebrows — italic serif lowercase (new in v2)

Eyebrows above headings now use **lowercase italic PT Serif**, not uppercase DM Sans. This is one of the system's signature moves.

```css
.eyebrow {
  font-family: var(--font-display);
  font-style: italic;
  font-weight: 400;
  font-size: var(--text-small);
  color: var(--color-accent);
  letter-spacing: 0;
  text-transform: none;
  margin-bottom: var(--space-1);
}
```

Example: `wednesday morning` (italic serif) above `Good morning, Alex` (display serif).

The old uppercase `.eyebrow-caps` style is deprecated but kept as an option for sheet eyebrows where the action category needs to feel like a system label (`CONFIRM`, `WARNING`):

```css
.eyebrow-caps {
  font-family: var(--font-body);
  font-size: var(--text-micro);
  text-transform: uppercase;
  letter-spacing: 0.10em;
  font-weight: 700;
  color: var(--color-accent);
}
```

Default to italic serif. Use caps only when the eyebrow is a *system label*, not a contextual phrase.

---

## 12. Spacing system (4-base)

Six stops: **4 · 8 · 12 · 16 · 24 · 32**. Use tokens.

### Default paddings (compact density)

| Element | Padding | Token |
|---|---|---|
| Screen edges | 16px | `--space-4` |
| Card interior | 16px | `--space-4` |
| List row | 12px 12px | `--space-3` |
| Section gap | 16px | `--space-4` |
| Button (default) | 12px 16px | `--space-3` × `--space-4` |
| Button (small, in-context) | 8px 12px | `--space-2` × `--space-3` |
| Button (large) | 16px 24px | `--space-4` × `--space-5` |
| Input field | 12px 12px | `--space-3` |

Note: button paddings raised slightly from v1 to ensure 44pt minimum tap targets without relying on hit-area overlays.

### Layout rules

- All vertical rhythm is multiples of 4.
- **Status bar safe area** at top: `padding-top: env(safe-area-inset-top)`.
- **Tab bar safe area** at bottom: `padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom))`.
- Side safe areas in landscape: `padding-left: env(safe-area-inset-left)`, same for right.
- **Use `100dvh` not `100vh`** for full-height layouts. `vh` includes the URL bar in standalone mode and causes layout jumps.

---

## 13. Corner radius (Sharp)

| Token | Value | Use for |
|---|---|---|
| `--radius-sm` | 4px | Badges, small accent pills, helper indicators |
| `--radius-md` | 6px | Default — buttons, inputs, cards, list rows, icons-in-rows |
| `--radius-lg` | 8px | Larger top-level cards, empty states, toasts |
| `--radius-xl` | 16px | Sheets/modals only — intentionally softer |
| `--radius-pill` | 100px | Toggle tracks, status dots, avatar circles, pill badges |

**Rule:** use `--radius-md` (6px) by default.

---

## 14. Shadows & elevation

| Token | Use for |
|---|---|
| `--shadow-sm` | Resting buttons, slight lift |
| `--shadow-md` | Cards, list groups, default elevation |
| `--shadow-lg` | Toasts, hover states, raised content |
| `--shadow-xl` | Sheets and modal overlays only |
| `--shadow-up` | Sheets specifically — casts upward |

**Rules:**

- All shadows use warm brown (`rgba(60,40,20,...)`), never pure black.
- Editorial cards (rule-based variant) get **no shadow** — they're not elevated surfaces.

---

## 15. Motion

### Tokens

```css
--duration-fast:    180ms;
--duration-normal:  220ms;
--duration-slow:    300ms;
--ease-out:         cubic-bezier(0.2, 0, 0, 1);
--ease-in-out:      cubic-bezier(0.65, 0, 0.35, 1);
--press-scale:      0.97;
```

### Rules

- **Default tap interaction:** `transition: transform var(--duration-fast) var(--ease-out)`. Press scales to `var(--press-scale)`.
- **Sheets/modals slide up** with `translateY(100%) → translateY(0)` over `--duration-normal`. Background scales to `0.96` simultaneously.
- **No springs, no overshoots, no bounces.**
- **Loading skeletons:** transform-based shimmer (see §16.14 for the perf-correct implementation), 1.6s linear infinite, neutral warm-gray.
- **List rows:** animate `transform` only on `:active`, never `background` or `box-shadow`. With long lists this matters.

### Reduced motion — degrade, don't freeze

The v1 blanket rule (`animation-duration: 0.01ms !important`) breaks loading skeletons and toast entry. v2 distinguishes decorative motion (kill it) from functional motion (replace with fade).

```css
@media (prefers-reduced-motion: reduce) {
  /* Decorative — kill outright */
  *, ::before, ::after {
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  /* Press scales, slide-ins, scale transforms — disable */
  .btn:active, .list-item:active { transform: none !important; }
  .sheet { transition: opacity var(--duration-fast) ease !important; transform: none !important; }
  .sheet.open { opacity: 1; }
  .sheet:not(.open) { opacity: 0; pointer-events: none; }
  .toast { transition: opacity var(--duration-fast) ease !important; transform: translateX(-50%) !important; }

  /* Functional motion — replace with fade, not freeze */
  .skeleton {
    animation: skeleton-pulse 2s ease-in-out infinite !important;
    background: rgba(60,40,20,0.07) !important;
  }
  @keyframes skeleton-pulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }
}
```

The skeleton still indicates "loading" — it just pulses opacity instead of sliding a gradient.

---

## 16. Components

Every component below uses tokens. **Sharp corners, compact density, soft shadows, crisp motion, sentence case** are baked in.

### 16.1 Buttons

```css
.btn {
  font-family: var(--font-body);
  font-size: var(--text-body);
  font-weight: 600;
  padding: var(--space-3) var(--space-4);
  min-height: 44px;                          /* enforced tap target */
  border-radius: var(--radius-md);
  border: none;
  cursor: pointer;
  letter-spacing: -0.005em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  transition: transform var(--duration-fast) var(--ease-out);
}
.btn:active { transform: scale(var(--press-scale)); }
.btn:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* Primary */
.btn-primary {
  background: var(--color-accent);
  color: var(--color-accent-text);
  box-shadow: var(--shadow-sm);
}

/* Secondary — paper-feel surface */
.btn-secondary {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border-strong);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.6) inset,
    0 1px 1px rgba(60,40,20,0.04);
}

/* Ghost */
.btn-ghost {
  background: transparent;
  color: var(--color-accent);
}

/* Destructive */
.btn-destructive {
  background: var(--color-error);
  color: var(--color-error-text);
  box-shadow: var(--shadow-sm);
}

/* Sizes — note .btn-sm is for in-context use only (toolbars, inline);
   it falls below 44pt minimum and requires hit-area extension via padding on parent */
.btn-sm { padding: var(--space-2) var(--space-3); font-size: var(--text-small); min-height: 32px; }
.btn-lg { padding: var(--space-4) var(--space-5); font-size: var(--text-h3); min-height: 52px; }

/* States */
.btn[disabled] { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
.btn-loading { color: transparent; pointer-events: none; position: relative; }
.btn-loading::after {
  content: '';
  position: absolute;
  width: var(--icon-sm); height: var(--icon-sm);
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.btn-success { background: var(--color-success); color: var(--color-success-text); }
@keyframes spin { to { transform: rotate(360deg); } }
```

**Focus ring change in v2:** the v1 box-shadow ring at 14% opacity failed WCAG 2.2 focus contrast. v2 uses a solid 2px outline with offset — meets 3:1 against linen and against any tinted surface.

**Rules:**

- One primary per screen.
- Verb-first: `Send`, `Confirm`, `Continue`. Never `OK`, `Submit`, `Click here`.
- After a successful action, primary briefly turns to `.btn-success` (~800ms) before navigating.
- `.btn-sm` is below 44pt — only use inside parents that provide additional hit padding.

### 16.2 Inputs

```css
.input {
  font-family: var(--font-body);
  font-size: var(--text-body);
  padding: var(--space-3);
  min-height: 44px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  color: var(--color-text);
  width: 100%;
  outline: none;
  box-shadow: 0 1px 2px rgba(60,40,20,0.04) inset;
  transition: border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}
.input::placeholder { color: var(--color-text-dim); }
.input:focus {
  border-color: var(--color-accent);
  box-shadow:
    0 1px 2px rgba(60,40,20,0.06) inset,
    0 0 0 3px var(--color-focus-ring);
}
.input.error { border-color: var(--color-error); }
.input.error:focus { box-shadow: 0 1px 2px rgba(60,40,20,0.06) inset, 0 0 0 3px rgba(140,58,46,0.32); }
.input.success { border-color: var(--color-success); }
.input[disabled] {
  background: rgba(60,40,20,0.04);
  color: var(--color-text-dim);
  cursor: not-allowed;
}

.input-label {
  font-size: var(--text-small);
  color: var(--color-text);                /* darkened from text-dim — labels are primary content */
  font-weight: 500;
}
.input-helper {
  font-size: var(--text-small);
  color: var(--color-text-dim);            /* now AA-compliant */
  margin-top: var(--space-1);
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.input-helper.error { color: var(--color-error); }
.input-helper.success { color: var(--color-success); }
.input-helper svg { width: var(--icon-xs); height: var(--icon-xs); }
```

**Rules:**

- Every input has a `<label>` (visible or `sr-only`).
- Error and success states show icon + colored border + helper text. Color is never the only signal.

### 16.3 Toggle

```css
.toggle {
  width: 46px; height: 28px;
  background: rgba(60,40,20,0.16);
  border-radius: var(--radius-pill);
  position: relative;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(60,40,20,0.08) inset;
  transition: background var(--duration-fast) var(--ease-out);
}
/* hit-area extension to 44pt minimum */
.toggle::before {
  content: '';
  position: absolute;
  inset: -8px;
}
.toggle::after {
  content: '';
  position: absolute;
  width: 24px; height: 24px;
  background: var(--color-surface);
  border-radius: 50%;
  top: 2px; left: 2px;
  box-shadow:
    0 1px 1px rgba(0,0,0,0.05),
    0 2px 4px rgba(0,0,0,0.12),
    0 0 0 0.5px rgba(0,0,0,0.04);
  transition: transform var(--duration-fast) var(--ease-out);
}
.toggle.on {
  background: linear-gradient(180deg, var(--color-accent) 0%, var(--color-accent-dark) 100%);
}
.toggle.on::after { transform: translateX(18px); }
```

### 16.4 Segmented control

```css
.segmented {
  display: flex;
  background: var(--color-accent-soft);
  padding: 3px;
  border-radius: var(--radius-md);
  gap: 2px;
}
.segmented button {
  flex: 1;
  background: transparent;
  border: none;
  padding: var(--space-2) var(--space-3);
  min-height: 36px;                          /* in-context exception, inside 44pt parent area */
  font-family: var(--font-body);
  font-size: var(--text-small);
  font-weight: 600;
  color: var(--color-text-dim);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all var(--duration-fast) var(--ease-out);
}
.segmented button.active {
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-sm);
}
```

### 16.5 Tabs

```css
.tabs {
  display: flex;
  gap: var(--space-5);
  border-bottom: 1px solid var(--color-border);
  position: relative;
}
.tabs button {
  background: transparent;
  border: none;
  padding: var(--space-3) 0;
  min-height: 44px;
  font-family: var(--font-body);
  font-size: var(--text-small);
  font-weight: 600;
  color: var(--color-text-dim);
  cursor: pointer;
  letter-spacing: -0.005em;
  transition: color var(--duration-fast) var(--ease-out);
  position: relative;
}
.tabs button.active { color: var(--color-text); }
.tabs button.active::after {
  content: '';
  position: absolute;
  bottom: -1px; left: 0;
  height: 2px;
  width: 56px;
  background: var(--color-accent);
  border-radius: 1px;
  box-shadow: 0 1px 4px rgba(184,137,90,0.4);
}
```

### 16.6 Cards (Editorial — rule-based)

The card is *not* a box. It's a content block bracketed by horizontal rules.

```css
.card {
  background: transparent;
  border-top: 2px solid var(--color-text);
  border-bottom: 1px solid var(--color-border-strong);
  border-radius: 0;
  padding: var(--space-3) 0;
  contain: layout style;                    /* perf — isolate paint */
}
.card-label {
  font-family: var(--font-display);
  font-style: italic;
  color: var(--color-text-dim);
  font-size: var(--text-small);
}
.card-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
```

**Rules:**

- Editorial cards use **italic PT Serif** for labels.
- Top rule 2px (heavy), bottom 1px (light) — editorial weight.
- Cards do not nest.
- For grouped lists use the **list** pattern below.

### 16.7 List rows

```css
.list {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}
.list-item {
  display: flex;
  align-items: center;
  padding: var(--space-3);
  min-height: 56px;                          /* enforced 44pt+ tap target */
  border-bottom: 1px solid var(--color-border);
  gap: var(--space-3);
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-out);
  contain: layout style;                     /* perf */
}
.list-item:active { transform: scale(0.99); }
.list-item:last-child { border-bottom: none; }

.list-item-icon {
  width: 32px; height: 32px;
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.list-item-content { flex: 1; min-width: 0; }
.list-item-title { font-size: var(--text-small); font-weight: 600; line-height: 1.3; }
.list-item-sub {
  font-size: var(--text-micro);
  color: var(--color-text-dim);
  margin-top: 1px;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
}
.list-item-amount {
  font-size: var(--text-small);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

/* Pending row variant (new in v2) */
.list-item.pending .list-item-title,
.list-item.pending .list-item-amount {
  font-style: italic;
  color: var(--color-pending);
}
```

**Icon style:** Filled SVG icon on a soft accent-tinted square. No emoji in production lists.

### 16.8 Sheets / modals

```css
.sheet {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: var(--color-surface);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  padding: var(--space-5) var(--space-4) calc(var(--space-5) + env(safe-area-inset-bottom));
  border-top: 1px solid var(--color-border);
  box-shadow:
    0 -1px 0 rgba(255,255,255,0.5) inset,
    var(--shadow-up);
  transform: translateY(100%);
  transition: transform var(--duration-normal) var(--ease-out);
  z-index: var(--z-sheet);
  max-height: 90dvh;
  overflow-y: auto;
}
.sheet.open { transform: translateY(0); }
.sheet::before {
  content: '';
  position: absolute;
  top: var(--space-2); left: 50%;
  transform: translateX(-50%);
  width: 36px; height: 4px;
  background: rgba(60,40,20,0.16);
  border-radius: var(--radius-pill);
}
.sheet-eyebrow {
  font-family: var(--font-display);
  font-style: italic;
  font-size: var(--text-small);
  color: var(--color-accent);
  margin: var(--space-2) 0 var(--space-1);
}
.sheet-title {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.005em;
  margin-bottom: var(--space-1);
  max-width: var(--measure-display);
}
.sheet-body {
  font-size: var(--text-small);
  color: var(--color-text-dim);
  line-height: 1.5;
  margin-bottom: var(--space-3);
  max-width: var(--measure-body);
}

/* Background scrim + scale (iOS-style modal presentation) */
.app-content {
  transition: transform var(--duration-normal) var(--ease-out),
              border-radius var(--duration-normal) var(--ease-out);
  transform-origin: center top;
}
.app-content.modal-open {
  transform: scale(0.96);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
```

**Rules:**

- Always include a grabber bar (4×36px).
- Always include an eyebrow above the title.
- Sheet titles **lead with the action**: "Send $48.00 to Sarah K." not "Confirm transfer."
- `--radius-xl` (16px) on top corners — softer than cards on purpose.

### 16.9 Toast notifications

```css
.toast {
  position: fixed;
  bottom: calc(var(--space-5) + env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%) translateY(100px);
  background: var(--color-surface);
  color: var(--color-text);
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-3);
  border-radius: var(--radius-lg);
  font-size: var(--text-small);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  border-left: 3px solid var(--color-success);
  box-shadow:
    0 0 0 1px var(--color-border),
    var(--shadow-lg);
  opacity: 0;
  transition: transform var(--duration-normal) var(--ease-out),
              opacity var(--duration-normal) var(--ease-out);
  z-index: var(--z-toast);
}
.toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
.toast.error   { border-left-color: var(--color-error); }
.toast.warning { border-left-color: var(--color-warning); }
.toast svg { width: var(--icon-sm); height: var(--icon-sm); flex-shrink: 0; color: var(--color-success); }
.toast.error svg   { color: var(--color-error); }
.toast.warning svg { color: var(--color-warning); }
```

**Rules:**

- Light surface with colored left rail.
- Always include context: "Payment sent to Sarah K." not "Payment sent."
- Auto-dismiss: 3s success/info, 5s warnings, persistent for errors.
- Use `role="status"` for success/info, `role="alert"` for errors.

### 16.10 Status banners (inline)

```css
.banner {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-small);
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.banner-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.banner.success {
  background: var(--color-success-soft);
  color: var(--color-success);
  border: 1px solid var(--color-success-border);
}
.banner.warning {
  background: var(--color-warning-soft);
  color: var(--color-warning);
  border: 1px solid var(--color-warning-border);
}
.banner.error {
  background: var(--color-error-soft);
  color: var(--color-error);
  border: 1px solid var(--color-error-border);
}
.banner.pending {
  background: var(--color-pending-soft);
  color: var(--color-pending);
  border: 1px solid var(--color-pending-border);
}
```

### 16.11 Badges

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 3px var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-micro);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.badge.success { background: var(--color-success-soft); color: var(--color-success); }
.badge.warning { background: var(--color-warning-soft); color: var(--color-warning); }
.badge.error   { background: var(--color-error-soft);   color: var(--color-error); }
.badge.pending { background: var(--color-pending-soft); color: var(--color-pending); }
.badge.neutral { background: var(--color-accent-soft);  color: var(--color-text); }
/* Note: accent-on-accent-soft is 2.8:1 — fails for text. Use --color-text on accent-soft tints,
   or switch to a solid accent fill (.badge.accent below) when the badge needs to read as primary. */
.badge.accent  { background: var(--color-accent);       color: var(--color-accent-text); }
```

### 16.12 Avatars

```css
.avatar {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(184,137,90,0.22), rgba(184,137,90,0.08));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: var(--color-accent);
  font-size: var(--text-small);
  letter-spacing: -0.02em;
  box-shadow:
    0 0 0 1px rgba(184,137,90,0.12),
    0 1px 0 rgba(255,255,255,0.4) inset;
}
.avatar.lg { width: 56px; height: 56px; font-size: var(--text-h3); }

.avatar-stack { display: flex; }
.avatar-stack .avatar + .avatar { margin-left: -10px; border: 2px solid var(--color-surface); }
```

### 16.13 Empty state

```css
.empty {
  text-align: center;
  padding: var(--space-6) var(--space-5) var(--space-5);
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  position: relative;
  overflow: hidden;
}
.empty::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 80px;
  background: radial-gradient(ellipse at center top, var(--color-accent-soft) 0%, transparent 70%);
  pointer-events: none;
}
.empty-icon {
  width: 56px; height: 56px;
  margin: 0 auto var(--space-3);
  background: linear-gradient(180deg, var(--color-accent-soft), rgba(184,137,90,0.04));
  border: 1px solid var(--color-accent-border);
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-accent);
  box-shadow: 0 1px 0 rgba(255,255,255,0.5) inset, 0 4px 12px rgba(184,137,90,0.15);
  position: relative;
}
.empty-title {
  font-family: var(--font-display);
  font-size: var(--text-h2);
  font-weight: 700;
  margin-bottom: var(--space-1);
  letter-spacing: -0.005em;
  position: relative;
}
.empty-body {
  font-size: var(--text-small);
  color: var(--color-text-dim);
  margin-bottom: var(--space-4);
  line-height: 1.5;
  max-width: var(--measure-body);
  margin-left: auto;
  margin-right: auto;
  position: relative;
}
```

### 16.14 Loading skeleton (perf-correct)

v1's `background-position` shimmer caused repaints every frame. v2 uses a `transform`-driven gradient overlay that's GPU-composited.

```css
.skeleton {
  position: relative;
  background: rgba(60,40,20,0.07);
  overflow: hidden;
  border-radius: var(--radius-sm);
  isolation: isolate;
}
.skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(255,252,247,0.6) 50%,
    transparent 100%);
  animation: shimmer 1.6s linear infinite;
}
@keyframes shimmer {
  to { transform: translateX(100%); }
}
.skeleton-line { height: 12px; }
.skeleton-line + .skeleton-line { margin-top: 6px; }
.skeleton-circle { border-radius: 50%; }
```

This composites on the GPU and is safe for 6+ rows.

### 16.15 Bottom tab bar

```css
.tabbar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: rgba(255,252,247,0.92);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  border-top: 1px solid var(--color-border);
  display: flex;
  padding: var(--space-2) var(--space-2) calc(6px + env(safe-area-inset-bottom));
  box-shadow: 0 -1px 0 rgba(255,255,255,0.5) inset;
  z-index: var(--z-tabbar);
}
/* Fallback for older devices where backdrop-filter tanks scroll perf */
@supports not (backdrop-filter: blur(24px)) {
  .tabbar { background: var(--color-surface); }
}

.tabbar-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: var(--space-2) var(--space-1);
  min-height: 44px;
  background: transparent;
  border: none;
  color: var(--color-text-dim);
  font-family: var(--font-body);
  border-radius: var(--radius-md);
  position: relative;
  transition: color var(--duration-fast) var(--ease-out);
}
.tabbar-item.active { color: var(--color-accent); }
.tabbar-item.active::before {
  content: '';
  position: absolute;
  top: -2px; left: 50%;
  transform: translateX(-50%);
  width: 18px; height: 2px;
  background: var(--color-accent);
  border-radius: 2px;
}
.tabbar-item svg { width: var(--icon-lg); height: var(--icon-lg); stroke-width: 1.8; }
.tabbar-item.active svg { stroke-width: 2.2; }
.tabbar-item span { font-size: 10px; font-weight: 600; letter-spacing: 0.01em; }
```

### 16.16 Dividers

```css
.divider { height: 1px; background: var(--color-border-strong); margin: var(--space-3) 0; }
.divider-double {
  border-top: 1px solid var(--color-border-strong);
  border-bottom: 1px solid var(--color-border);
  height: 4px;
  margin: var(--space-3) 0;
}
.divider-ornament {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: var(--space-3) 0;
  color: var(--color-accent);
}
.divider-ornament::before, .divider-ornament::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-border-strong);
}
.divider-ornament .ornament {
  font-family: var(--font-display);
  font-size: 14px;
  font-style: italic;
}
```

### 16.17 Icon system (new in v2)

Icons are inline SVG, sized via `--icon-*` tokens, colored via `currentColor`.

```css
.icon {
  display: inline-block;
  width: var(--icon-md);
  height: var(--icon-md);
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex-shrink: 0;
}
.icon-xs { width: var(--icon-xs); height: var(--icon-xs); }
.icon-sm { width: var(--icon-sm); height: var(--icon-sm); }
.icon-lg { width: var(--icon-lg); height: var(--icon-lg); stroke-width: 1.6; }
.icon-xl { width: var(--icon-xl); height: var(--icon-xl); stroke-width: 1.6; }
.icon-filled { fill: currentColor; stroke: none; }
```

**Rules:**

- All UI icons are inline SVG with `viewBox="0 0 24 24"`.
- Stroke style is default; fill style for tab bar active states and tinted-square row icons.
- Icon-only buttons require `aria-label`.
- Decorative icons require `aria-hidden="true"`.
- Use a single icon set per app (Lucide, Phosphor, custom). Don't mix.

---

## 17. Voice & microcopy

The app speaks in **second person, sentence case, plainly, with confident brevity.**

### Person & address

- Use **"you"** to refer to the user.
- The app does not refer to itself ("we" / "I"). Just facts and instructions.

### Tone — Confident & direct

- Lead with the answer or the action.
- No filler, no hedge words, no apologies.
- No exclamation marks except in success toasts (rarely).
- ❌ "Oops! It looks like we couldn't process your payment right now. Please try again later!"
- ✅ "Card ending 4521 was declined. Try a different card."

### Errors — Plain & specific

| Don't | Do |
|---|---|
| "Something went wrong" | "We couldn't connect to your bank. Check your internet and retry." |
| "Invalid input" | "Enter a complete phone number." |
| "Error 500" | "Our service is down. Try again in a few minutes." |

### Empty states — Editorial poetic

- Title: `A blank ledger` (not `No transactions yet`)
- Body: `Your transactions will appear here once you start sending or receiving.`
- CTA: verb-first (`Send first payment`)

### Confirmations — Statement form

- Eyebrow: `confirm` (italic serif lowercase)
- Title: `Send $48.00 to Sarah K.`
- Body: `This will transfer immediately and can't be undone.`
- Buttons: `Cancel` / `Confirm`

### Buttons — Verb-first

`Send`, `Confirm`, `Cancel`, `Continue`, `Save`, `Delete`. Never `OK`, `Submit`, `Click here`. Destructive: be explicit. `Delete account`.

### Casing — Sentence case everywhere

Buttons, tabs, section headers, labels. Exception: proper nouns and acronyms.

### Numbers

- Numerals in UI: `3 transactions`.
- Commas for thousands: `$12,847.32`.
- Tabular numerals where stacked.

### Currency display

- Hero balances: special treatment, see §18.
- Inline: full size. `Sent $48.00 to Sarah.`
- Use `+` and `−` (U+2212 minus sign, not the hyphen-minus on the keyboard) for signed amounts.

### Dates & time

- **Today** / **Yesterday** for recent.
- **Tuesday** for this week.
- **Mar 12** for this year.
- **Mar 12, 2024** once it crosses years.
- **Today, 8:14 AM** with time.
- AM/PM, not 24-hour.

### Greetings (time-of-day)

Format: `<day> <part of day>` italic-serif eyebrow, then `Good <part of day>, <Name>` display title.

- 5 AM – 12 PM → `morning`
- 12 PM – 5 PM → `afternoon`
- 5 PM – 9 PM → `evening`
- 9 PM – 5 AM → `night` (use "Hello" — never tell users goodnight)

Example: `wednesday morning` / `Good morning, Alex`.

---

## 18. Money & data display

### Hero balance

```html
<div class="money-display money-xl">
  $12,847<span class="cents">.32</span>
</div>
```

```css
.money-display { font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.money-xl {
  font-family: var(--font-body);
  font-size: 38px;
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1;
}
.money-xl .cents { font-size: 22px; color: var(--color-text-dim); font-weight: 600; }

/* Small balance — full-size cents (under $100, dimming reads as condescending) */
.money-xl.small-balance .cents {
  font-size: inherit;
  color: inherit;
  font-weight: inherit;
}
```

**Rule:** apply `.small-balance` class when balance is under $100. Implement in your formatter.

### Signed amounts

v2 reverses v1's neutral-negative rule. Negatives need to feel different from descriptive text at a glance.

```css
.money-positive { color: var(--color-positive); font-weight: 600; }
.money-positive::before { content: '+ '; }

.money-negative { color: var(--color-negative); font-weight: 600; }
.money-negative::before { content: '− '; } /* U+2212 minus sign, not hyphen-minus */
```

**Rules:**

- Positive: green (`--color-positive`), bold, `+` prefix.
- Negative: deep warm brown (`--color-negative`), bold, `−` prefix. Distinct from text but **never red** — red stays for errors only.
- Both bold so users can scan signed amounts in a long list without color alone carrying the meaning.

### Pending state

```css
.money-pending {
  color: var(--color-pending);
  font-style: italic;
}
.money-pending::after {
  content: ' · pending';
  font-style: italic;
  font-family: var(--font-display);
  font-size: 0.85em;
  color: var(--color-pending);
  font-weight: 400;
}
```

### Hide-balance mode

Users on shared devices or in public should be able to obfuscate balances.

```css
.balance-hidden {
  font-family: var(--font-mono);
  letter-spacing: 0.1em;
}
/* Fixed 6 dots regardless of actual balance length — a 4-dot mask leaks "value is small". */
.balance-hidden::before { content: '••••••'; }
.balance-hidden .actual-value { display: none; }

/* Tappable reveal affordance */
.balance-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-small);
  color: var(--color-text-dim);
  cursor: pointer;
  margin-left: var(--space-2);
}
```

Implement as a toggle in account settings + a tap-to-reveal on the hero balance itself. State persists across sessions.

### Charts (when added)

- Single-color: `var(--color-accent)`.
- Comparison: accent + dimmed neutral (`rgba(60,40,20,0.3)`).
- Status: success/warning/error/pending tokens.
- Axes: `var(--color-text-faint)`, 1px lines.
- Labels: `var(--text-micro)` uppercase, `var(--color-text-dim)`.

---

## 19. Editorial flourishes

### Pull quote

```html
<blockquote class="pull-quote">
  Your account balance is a snapshot, not a story.
  <cite class="pull-quote-cite">— Welcome screen</cite>
</blockquote>
```

```css
.pull-quote {
  font-family: var(--font-display);
  font-size: 22px;
  font-style: italic;
  font-weight: 400;
  line-height: 1.35;
  border-left: 3px solid var(--color-accent);
  padding: var(--space-1) 0 var(--space-1) var(--space-4);
  letter-spacing: -0.005em;
  max-width: var(--measure-display);
}
.pull-quote-cite {
  display: block;
  font-family: var(--font-body);
  font-style: normal;
  font-size: var(--text-small);
  color: var(--color-text-dim);
  margin-top: var(--space-2);
  text-transform: uppercase;
  letter-spacing: 0.10em;
  font-weight: 600;
}
```

### Footnotes

```html
Your funds earn 4.20% APY<sup>1</sup> on balances over $1,000.

<div class="footnote">
  <sup>1</sup>
  <span>Annual percentage yield as of March 2025. Rate is variable…</span>
</div>
```

```css
sup {
  font-family: var(--font-display);
  font-style: italic;
  color: var(--color-accent);
  font-size: var(--text-small);
}
.footnote {
  font-size: var(--text-small);
  color: var(--color-text-dim);
  line-height: 1.5;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
  display: flex;
  gap: var(--space-2);
  max-width: var(--measure-body);
}
```

### Captions

```css
.caption {
  font-family: var(--font-display);
  font-size: var(--text-micro);
  font-style: italic;
  color: var(--color-text-dim);
  text-align: center;
  padding-top: var(--space-1);
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
}
```

---

## 20. iOS PWA setup

### HTML head — required meta tags

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">

  <!-- iOS PWA -->
  <!-- Both forms required: apple- prefix is the legacy one iOS still honors;
       the unprefixed form is the standard and what iOS 17+ prefers. -->
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <!-- black-translucent lets your linen background paint under the status bar
       seamlessly. With "default", linen-against-white creates a visible seam. -->
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="App Name">

  <!-- Theme color (browser chrome, manifest splash) -->
  <meta name="theme-color" content="#F5EFE6">

  <!-- Icons -->
  <link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png">
  <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
  <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">

  <!-- Manifest drives splash on iOS 16.4+ via background_color + icon -->
  <link rel="manifest" href="/manifest.json">

  <!-- Optional legacy splash for iOS <16.4 — single image is fine, not the full 14-size matrix -->
  <link rel="apple-touch-startup-image" href="/splash-portrait.png">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=PT+Serif:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
</head>
```

### manifest.json

```json
{
  "name": "App Name",
  "short_name": "App",
  "description": "App description",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#F5EFE6",
  "background_color": "#F5EFE6",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

iOS 16.4+ generates the splash from `background_color` + the largest icon. The 14-image splash matrix from v1 is no longer required.

### Safe areas

```css
.app-shell {
  min-height: 100dvh;                         /* dvh, not vh */
  padding-top: env(safe-area-inset-top);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  background: var(--color-bg);                /* paints under translucent status bar */
}
.tabbar { padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom)); }
.sheet  { padding-bottom: calc(var(--space-5) + env(safe-area-inset-bottom)); }
```

### Viewport units — use `dvh`

```css
.full-height { min-height: 100dvh; }   /* dynamic — accounts for URL bar */
.sheet { max-height: 90dvh; }
/* Avoid 100vh — includes URL bar height in standalone mode and causes jumps */
```

### Scroll lock — the version that actually works on iOS

`overscroll-behavior` doesn't lock the document body on iOS Safari (works only inside scroll containers). The reliable pattern:

```javascript
let scrollY = 0;
function lockScroll() {
  scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
}
function unlockScroll() {
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  window.scrollTo(0, scrollY);
}
```

Call `lockScroll()` when opening sheets/modals, `unlockScroll()` when closing.

**Caveats (new in v2.1):** this pattern only preserves vertical scroll — horizontal scroll position is lost on reopen, and any element using viewport-relative `position: sticky` will lose its anchor while body is fixed. For RTL layouts, wide canvases, or sticky-heavy screens, prefer `<dialog>` with the `inert` attribute on the background `<main>` instead.

### Keyboard handling — use visualViewport, not setTimeout

The v1 300ms setTimeout was fragile. v2 uses `visualViewport` directly:

```javascript
if ('visualViewport' in window) {
  // Track keyboard offset for layout adjustments
  window.visualViewport.addEventListener('resize', () => {
    const offset = window.innerHeight - window.visualViewport.height;
    document.documentElement.style.setProperty('--keyboard-offset', `${offset}px`);
  });

  // Scroll focused input into view when keyboard appears
  window.visualViewport.addEventListener('resize', () => {
    const active = document.activeElement;
    if (active && active.matches('input, textarea, [contenteditable]')) {
      active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
}
```

### Pull-to-refresh

Per-screen, accent-colored spinner. Native rubber-band via `overscroll-behavior: auto`; intercept the gesture at ~80px drag.

### Backdrop-filter fallback

The tab bar's `backdrop-filter: blur(24px) saturate(140%)` is expensive on iPhone 11 / SE. Provide a fallback:

```css
.tabbar {
  background: rgba(255,252,247,0.92);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
}
@supports not (backdrop-filter: blur(24px)) {
  .tabbar { background: var(--color-surface); }
}
```

### Splash screen

Generate one wordmark image (linen background, `#2A2520` PT Serif 700) and let the manifest handle the rest. iOS 16.4+ composes the splash from `background_color` + the largest icon. For iOS <16.4, the single `apple-touch-startup-image` provides a baseline.

### Home screen icon

Each app gets its own mark. Default template:

- 1024×1024 source
- Linen background or accent square
- Serif monogram or custom mark
- iOS auto-rounds to its squircle

---

## 21. Accessibility floors (non-negotiable)

### Contrast — WCAG AA, verified

All token values verified for contrast against `--color-bg` (#F5EFE6):

| Token | Ratio | Passes |
|---|---|---|
| `--color-text` (#2A2520) | 9.8:1 | AAA all sizes |
| `--color-text-dim` (#6F665B) | 5.1:1 | AA all sizes |
| `--color-text-faint` (#877E72) | 3.6:1 | AA large only (≥18px) |
| `--color-accent` (#B8895A) | 3.0:1 | AA large + UI components |
| `--color-accent-text` on `--color-accent` | 4.7:1 | AA all sizes |
| `--color-success` (#3F6B3F) | 5.4:1 | AA all sizes |
| `--color-warning` (#A6741F) | 5.0:1 | AA all sizes |
| `--color-error` (#8C3A2E) | 6.4:1 | AA all sizes |

### Contrast on tinted surfaces (new in v2.1)

Status text usually appears on its matching `*-soft` background, not on linen. Verified ratios for that pairing:

| Foreground | Background | Ratio | Passes |
|---|---|---|---|
| `--color-success` | `--color-success-soft` over `--color-bg` | 5.0:1 | AA all sizes |
| `--color-warning` | `--color-warning-soft` over `--color-bg` | 4.6:1 | AA all sizes |
| `--color-error` | `--color-error-soft` over `--color-bg` | 6.0:1 | AA all sizes |
| `--color-pending` | `--color-pending-soft` over `--color-bg` | 4.7:1 | AA all sizes |
| `--color-accent` | `--color-accent-soft` over `--color-bg` | 2.8:1 | UI only — **not text** |

**Rule (new):** `--color-accent` may not be used as text on `--color-accent-soft`. For accent-tinted badges or pills carrying text, either (a) use `--color-text` as the text color and let the soft tint be decorative, or (b) use solid `--color-accent` background with `--color-accent-text` foreground.

**Rule:** never use `--color-text-faint` on text smaller than 18px. Never use `--color-accent` for body copy — only for UI components and large display text.

### Tap targets — 44×44pt minimum, enforced by `min-height`

Every interactive element has `min-height: 44px` (or 56px for list rows). Smaller in-context elements (`.btn-sm`, segmented control buttons, toggle handles) require their parent containers to provide additional hit padding via `::before` overlays.

### Focus rings — solid outline with offset

WCAG 2.2 requires 3:1 contrast for focus indicators against any adjacent color. v1's 14% opacity ring failed this. v2 uses:

```css
:focus { outline: none; }
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: var(--radius-md);
}
```

For inputs (where the 2px outline would clash with the border), use the box-shadow ring with the stronger `--color-focus-ring`.

### Screen reader

- Every icon-only button: `aria-label="Description"`.
- Every form field: paired `<label for="...">` (visible or `sr-only`).
- Decorative icons: `aria-hidden="true"`.
- Status messages: `role="status"` (polite) for success/info, `role="alert"` (assertive) for errors.
- Modal/sheet: `role="dialog"`, `aria-modal="true"`, `aria-labelledby="..."`.
- VoiceOver: visible button text must match `aria-label` exactly.

### Color is never the only signal

- Errors: red border + icon + helper text.
- Success: green border + icon + helper text.
- Required fields: asterisk + label note.
- Status badges: text label + dot + tinted background.
- Money: `+`/`−` prefix + bold weight + color.

### Reduced motion

See §15. v2 distinguishes decorative motion (kill it) from functional motion (replace with fade).

### Dynamic Type — explicit stance

This system uses px-based type tokens to maintain visual hierarchy. **It does not honor iOS Dynamic Type.** Users who need larger text should use system zoom (Settings → Accessibility → Zoom), which scales the entire interface proportionally.

If full Dynamic Type support is required for a specific app, switch the type tokens to rem and re-test all components at 200% zoom. The system was designed for the px scale; rem'ing it is a meaningful project.

### Semantic HTML

Use real elements: `<button>` not `<div onclick>`. `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>` where appropriate. Headings in order — no skipping.

---

## 22. Token naming convention

Pattern: `--namespace-property-variant-state`, kebab-case, semantic over literal.

| Namespace | Pattern | Example |
|---|---|---|
| Color | `--color-{role}` | `--color-accent`, `--color-text-dim` |
| Status | `--color-{status}-{variant}` | `--color-success-soft` |
| Type family | `--font-{role}` | `--font-display`, `--font-body` |
| Type size | `--text-{step}` | `--text-h1`, `--text-body` |
| Spacing | `--space-{step}` | `--space-3` |
| Radius | `--radius-{size}` | `--radius-md` |
| Shadow | `--shadow-{size}` | `--shadow-md` |
| Duration | `--duration-{speed}` | `--duration-fast` |
| Easing | `--ease-{type}` | `--ease-out` |
| Layer | `--z-{role}` | `--z-sheet`, `--z-toast` |
| Icon | `--icon-{size}` | `--icon-md` |
| Measure | `--measure-{role}` | `--measure-body` |

**Why semantic > literal:** `--color-accent` survives a redesign. `--tan-500` does not.

---

## 23. File structure (for apps beyond #3)

The system itself is one canonical document — this file. The *implementation* may split across multiple stylesheets once you cross app #3, but the spec stays unified. Don't fork the doc per app.

The single-file token sheet from v1 stops scaling around app #3. Recommended implementation structure once you cross that line:

```
styles/
  tokens/
    color.css        ← all --color-* tokens
    type.css         ← --font-*, --text-*, --measure-*
    space.css        ← --space-*, --radius-*, --shadow-*
    motion.css       ← --duration-*, --ease-*, --press-scale
    layers.css       ← --z-*, --icon-*
  base.css           ← reset, body styles, tap behaviors
  components/
    button.css
    input.css
    card.css
    list.css
    sheet.css
    ...
  utilities.css      ← .sr-only, .text-content, etc.
  index.css          ← imports all of the above
```

For 1–2 apps, keep it in one file. Past that, split.

---

## 24. Quick reference — building a new screen

When building a screen:

1. **Wrap** in `.app-shell` with safe-area padding and `min-height: 100dvh`.
2. **Header** uses time-of-day greeting (italic-serif eyebrow + display title).
3. **Use editorial cards** (rule-based) for primary content blocks. Use `.list` for repeating items.
4. **One Display per screen.** One primary CTA per screen.
5. **Apply tokens, never raw values.** Every property references a `var(--*)`.
6. **Sentence case** all labels.
7. **Verb-first** all buttons.
8. **Tabular numerals** for stacked numbers.
9. **Signed money** uses `+`/`−` prefix, bold weight, positive/negative color.
10. **Cap line length** with `--measure-display` on headlines, `--measure-body` on body prose.
11. **Safe-area aware** at top, bottom, sides.
12. **Reduced-motion safe** — decorative motion off, functional motion fades.
13. **Tap targets ≥44pt.**
14. **Focus rings** visible (solid outline, not low-opacity ring).
15. **No emoji in production UI lists** — SVG icons via `--icon-*` tokens.
16. **No new colors.** Use the status matrix; derive via `color-mix()` only if no token fits.
17. **Pending and hide-balance** patterns supported where money is shown.

---

## 25. Quick HTML starter

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>App Name</title>
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="theme-color" content="#F5EFE6">
  <link rel="manifest" href="/manifest.json">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=PT+Serif:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/system.css">
</head>
<body>
  <div class="app-shell">
    <header class="screen-header">
      <div class="eyebrow">wednesday morning</div>
      <h1 style="font-family: var(--font-display); font-size: var(--text-display); font-weight: 700; letter-spacing: -0.005em; line-height: 1.05; max-width: var(--measure-display);">
        Good morning, Alex
      </h1>
    </header>

    <main>
      <!-- screen content using only tokens & component classes -->
    </main>
  </div>

  <nav class="tabbar">
    <!-- tab items -->
  </nav>
</body>
</html>
```

---


---

## 26. The five-second test (after composition + paint)

Before shipping any screen, verify:

1. Did you walk all 12 decisions in §2 and state the answers? (If not, you vibe-coded it — start over.)
2. Does it look like it was made by the same studio as your last app?
3. Is there at most one screen in this app using `--text-display` for its title?
4. Are all numbers tabular (`font-variant-numeric: tabular-nums`)?
5. Are buttons verb-first, sentence case?
6. Do empty / error / loading / pending states all exist? (Decisions 8 + 9)
7. Are negative amounts visually distinct from descriptive text?
8. Are all interactive elements ≥44pt?
9. Did you use `100dvh` not `100vh`?
10. Are focus rings solid outlines, not low-opacity glows?
11. Does `--color-text-faint` appear only on text ≥18px?
12. Did you run the smell tests in §3 and clear them all?

If any answer is "no", revise before shipping.

The 12 smell tests are the *first-pass* check during generation; this 12-question test is the *final* check before handoff. Both are required. Skipping either is how vibe creeps back in.

---

## 27. The one-page mental model

If you forget everything else in this document, remember this:

**Process:**
1. Pick a *one thing* the screen does (Decision 1).
2. Name what's *content* and what's *chrome* (Decision 2).
3. Pick a *density tier* (Decision 3) and a *type ceiling* (Decision 4).
4. Place the *primary action* (Decision 5).
5. Decide what chrome the screen *earns* (Decision 10).
6. Name what you're *deliberately omitting* (Decision 12).

**Paint:**
1. Use *tokens, not raw values* (§8).
2. *Sharp corners, soft shadows, crisp motion, sentence case* (§9).
3. *One Display per app, one primary CTA per screen.*
4. *Tabular numerals, signed money, italic-serif eyebrows.*
5. *44pt tap targets, solid focus rings, light mode forever.*

If both halves are honored, the screen looks designed. If either half is skipped, it doesn't.

---

*v3.0 — composition + paint, in one document. Process before pixels. Light mode only, forever. Update this doc, not individual app stylesheets.*
