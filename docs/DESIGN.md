# Design

The system behind the FOBS interface. Everything here is enforced by
`apps/web/app/globals.css` — this file explains *why* the values are what they
are, so a later change can tell the difference between a decision and a habit.

The stylesheet opens with an unnumbered token block, then 13 numbered sections:
1 Base · 2 Shell and navigation · 3 Page frame · 4 Surfaces · 5 Controls ·
6 Data display · 7 Disclosure · 8 Trade card and panels · 9 Utilities ·
10 Landing · 11 Prose pages · 12 Responsive · 13 Keyframes.

---

## One theme

There is no light mode. `globals.css` has a single `:root`, and the only
`@media` queries in it are width breakpoints and `prefers-reduced-motion`.
There is no `prefers-color-scheme` block and no manual toggle.

This is a decision, not an omission. A second palette would double every
contrast decision in the tables below, and the amber disclosure surface is a
safety surface — it should not have two variants that can drift apart. The
app is also read in the dark, next to a wallet, at night.

What follows from having one theme:

- `color-scheme: dark` on `:root`, so native controls, scrollbars and autofill
  render dark instead of light-on-dark.
- `viewport.themeColor: "#08070c"` in `app/layout.tsx`, so mobile browser chrome
  matches the page instead of flashing white above it.
- `<html>` carries its own background, so the first paint before the stylesheet
  applies is already dark rather than a white flash.

---

## Palette

Tokens live in `:root` and nowhere else. The ratios below are measured, not
estimated — each is the WCAG contrast ratio of the pair named.

### Surfaces

| Token               | Value     | Used for                                       |
| ------------------- | --------- | ---------------------------------------------- |
| `--paper`           | `#08070c` | The page background.                            |
| `--sunken`          | `#0e0c16` | Cards and panels.                               |
| `--raised`          | `#15121f` | Anything sitting *on* a card: chips, rows.      |
| `--elevated`        | `#1a1626` | Menus, sheets, popovers above a card.           |
| `--well`            | `#050409` | Deeper than the page: inputs, chart beds.       |
| `--hairline`        | `#221d31` | The default border.                             |
| `--hairline-strong` | `#322b47` | Borders that need to be found: inputs, chips.   |

### Text

| Token     | Value     | Contrast on `--paper` | Notes                     |
| --------- | --------- | --------------------- | ------------------------- |
| `--ink`   | `#ece9f6` | **16.78:1**           | Primary text              |
| `--muted` | `#9d97b3` | **7.18:1**            | Secondary text            |
| `--faint` | `#3a3450` | —                     | Non-text decorations only; also the placeholder colour, which is why it is not a text token |

`--muted` also clears AA on the raised surfaces it appears on: **6.60:1** on
`--raised`, **7.31:1** on `--well`.

### Semantic

| Token    | Value     | Contrast on `--paper` | Meaning                          |
| -------- | --------- | --------------------- | -------------------------------- |
| `--up`   | `#3ddc84` | **11.25:1**           | A price or position that went up. |
| `--down` | `#ff5c5c` | **6.63:1**            | A price or position that went down. |
| `--fomo` | `#a855f7` | **5.07:1**            | The one accent.                   |
| `--info` | `#818cf8` | **6.73:1**            | Neutral informational.            |

### Ink for filled surfaces

Two pairs exist because white does not survive on these fills:

| Token            | Value     | On            | Ratio        |
| ---------------- | --------- | ------------- | ------------ |
| `--ink-on-up`    | `#06200f` | `--up`        | **9.64:1**   |
| `--ink-on-down`  | `#2a0606` | `--down`      | **6.15:1**   |

White on `--up` is **1.78:1** and on `--down` **3.02:1** — both under the AA
floor for a 14px label, so white was never an option on the Buy/Sell submit
buttons or the active Buy/Sell segment. The green and red stay bright: they are
the price colours, read on near-black everywhere else in the app, and dimming
them to make white text work would cost far more than it bought.

`--fomo-solid` (`#7c3aed`) exists for the same reason on the violet side: white
on `--fomo` is **3.95:1**, which fails AA for button and badge labels. White on
`--fomo-solid` is **5.70:1**.

### Disclosure

| Token            | Value     | Contrast on `--warn-bg` |
| ---------------- | --------- | ----------------------- |
| `--warn-bg`      | `#241a06` | —                       |
| `--warn-ink`     | `#f5d98a` | **12.38:1**             |
| `--warn-ink-dim` | `#d9c07a` | **9.61:1**              |
| `--warn-rule`    | `#f0a100` | —                       |

### Tints, elevation, glass, motion

`--fomo-tint` / `--up-tint` / `--down-tint` are `color-mix(in srgb, <colour>
12%, transparent)` — never hand-mixed, so they follow their source token.

Elevation runs `--shadow-xs` → `--shadow-xl`, plus `--shadow-glow` (violet),
`--shadow-up` and `--shadow-down` for glowing figures. `--highlight-top` and
`--highlight-inner` are the inset bevels that stop a dark card from reading
flat.

Glass is `--glass` / `--glass-solid` / `--glass-border` with
`--blur: saturate(150%) blur(20px)`. Both `backdrop-filter` and
`-webkit-backdrop-filter` are declared wherever it is used.

Motion is `--duration-instant | fast | normal | slow` (100/160/240/400ms) and
`--ease-out | --ease-in-out | --ease-spring | --ease-drawer`, composed into
`--transition-fast | --transition-med | --transition-slow`. Nothing animates
with a bare `ease` or a bare millisecond count.

Avatars use `--avatar-0` … `--avatar-4`, five light two-stop gradients chosen so
five avatars stay distinguishable on near-black without any of them reading as
a status colour.

### Gradients

`--fomo-gradient` runs `#7c3aed → #9333ea`. Both ends must clear AA against
white text: the lightest stop is **5.37:1**, where the old `#c084fc` end was
2.64:1 and made every gradient button label unreadable.

### The literals outside `:root`

Not everything is a token, on purpose. There are 20 raw values outside the
token block, in four groups:

- **`#fff` on a filled surface** — `::selection`, `.button`, `.fomo`, `.mark`,
  `.avatar`, `.tab.active`, `.badge`. These mean pure white, and they sit on
  `--fomo-solid` or a gradient that is verified above. Naming them would imply
  they should change with the palette; they should not.
- **Violet stops that exist only inside the landing** — `#d8b4fe` (`.chip.accent`,
  `.hero-eyebrow`), `#cdbdf0` (`.hero-tagline`), and the `.hero-word` gradient
  `#ffffff → #efe6ff → #c9a9f7 → #7c3aed`; also `.wordmark`'s
  `#ffffff → #d8c9f5`. These are the only place in the product with a light-on-
  dark violet ramp, and confining them to the landing is the point.
- **The scene** — `#241640 → #0d0a1a → #08070c` in `.scene::after`, the page
  colour as the last stop so the planet's glow dissolves into the page rather
  than ending on an edge.
- **`#000` in a mask** — `.scene-rings` uses `#000` as a mask stencil. Alpha
  only; the colour is irrelevant, and a token would suggest otherwise.

---

## Three rules that are product rules

These are not taste. They are the visual half of things this app says in words,
and all three are easy to undo by accident.

### 1. Green and red only ever sit on a figure

`--up` and `--down` are applied to a number that was read off the chain or the
oracle, and to nothing else. Not a heading, not an icon, not a border used as
decoration, and not a button background standing in for "go".

The reason is that this build spends a lot of copy telling people not to read
things into its numbers — *"price not read"*, *"not enough trades to chart yet"*,
*"nothing is worth anything"*. If the interface also used green as a generic
accent, the colour would mean nothing wherever it does carry meaning.

The consequence worth knowing: **the primary button is violet (`--fomo`), not
green**, and the Buy/Sell toggle is the only place a trade colour fills a
control, because there the colour *is* the meaning.

### 2. Never render a figure the indexer did not read

Where a price is absent, the UI says so — `price not read`, an em dash, a stated
count of excluded holdings. It does not render `$0.00`, and it does not
interpolate. This rule lives mostly in the query layer and the calling
components, but the design supports it: there is no "empty value" style that
makes a missing number look like a real one.

### 3. Disclosure amber is a safety surface

`--warn-*` is not a fourth accent. Do not restyle it, retint it, or move it into
the violet family. Amber means "the app is telling you something it would rather
not have to", and it has no other job.

---

## Type

Two families, self-hosted from `app/fonts/`, loaded by `next/font/local` in
`app/layout.tsx` and mounted on `<html>` as `--font-sans` and `--font-mono`.

**Geist** for words. **GeistMono** for every figure, address and signature,
always with `tabular-nums`. Both are variable fonts (`weight: "100 900"`,
`display: "swap"`).

### The `--font-sans` cycle, and why `--sans` exists

`next/font/local` mounts `--font-sans` and `--font-mono` on `<html>`. Those two
names **must not be redeclared in `:root`.**

`:root` *is* `<html>`. So a rule such as
`--font-sans: var(--font-sans), ui-sans-serif, …` is a self-reference, and CSS
resolves a cycle to the guaranteed-invalid value. Consequence: both variables
compute to the empty string, so every `font-family: var(--font-sans)` is
invalid at computed-value time and falls back to the **initial** value — Times
New Roman — on every page, with both Geist faces never even fetched.

That is exactly what had happened. It is invisible in a downsampled screenshot
and was caught only because an e2e test asserts the computed family.

So the composed stacks get names of their own:

```css
--sans: var(--font-sans, ui-sans-serif), system-ui, -apple-system,
  "Segoe UI", sans-serif;
--mono: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas,
  monospace;
```

Everything in the stylesheet uses `var(--sans)` / `var(--mono)`; nothing uses
`var(--font-sans)`. The `var()` fallback also covers the case where the font
class fails to mount at all.

`layout.tsx` deliberately declares **no** `fallback:` array. Naming fallbacks in
both places produced a stack with `system-ui, -apple-system, "Segoe UI",
sans-serif` in it twice.

### Scale

| Token     | Size | Used for                                      |
| --------- | ---- | --------------------------------------------- |
| `--t-xs`  | 11px | Chips, definition terms, section markers       |
| `--t-sm`  | 12px | Secondary metadata, `.figures`                 |
| `--t-base`| 14px | Body copy in the app                           |
| `--t-md`  | 16px | Landing hero body                              |
| `--t-lg`  | 20px | Card headlines, the order-size input           |
| `--t-xl`  | 30px | Page and section titles                        |
| `--t-2xl` | 40px | The asset price figure; `.prose-head h1`       |
| `--t-3xl` | 56px | Unused — the hero wordmark is a `clamp()` instead |

Five rules in the file bypass this scale, each for a reason:

| Rule                  | Size | Why not a token                                          |
| --------------------- | ---- | -------------------------------------------------------- |
| `.prose-section p`    | 15px | Long-form body reads better a step above the app's 14px, and it is the only place that is true |
| `.mark`               | 15px | The "F" glyph inside a fixed 32px box — sized to the box, not to the scale |
| `.synthetic`, `.badge`| 10px | Badges are 18px tall; `--t-xs` at 11px does not fit them  |
| `.bottom-nav a`       | 10px | Six destinations in 358px at 390px — see the space section |

Letter-spacing is a token too: `--ls-tight` (-0.025em) for large headings,
`--ls-normal` (0), `--ls-wide` (0.04em), `--ls-caps` (0.12em) for uppercase
micro-labels. Uppercase tracking keeps an 11px label reading as a label rather
than as small body text. The bottom nav restates `0.04em` literally rather than
using `--ls-wide`, which is the same value and one of the few places the file
does that.

Two utility classes carry the mono treatment:

- `.num` — a single figure. Wraps a price, a total, a holder count.
- `.figures` — a whole line of figures. The `1,240.00 USDC · 6.79 shares at
  182.40` line under a feed card's headline.

---

## Space, shape, measure

`--s-1` … `--s-10`:
**4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 80 · 96**

Any space *between* two things — section padding, stack gaps, grid gutters —
is one of these. There is no 10px, no 18px, no 26px in the layout.

Geometry *inside* a component is a different matter, and the stylesheet says so
by using raw values there. There are ~15 of them, in three kinds:

- **Control and icon boxes** — `height: 38px` on a nav link and a segmented
  button, `44px`, `48px`, `32px` on the mark, `36px` on an avatar. These are
  sizes, not spaces; the scale is a spacing scale and rounding a 38px control to
  32 or 48 would change the control.
- **Sub-token optical nudges** — `gap: 2px` (5 uses), `gap: 3px`, `gap: 5px`,
  `padding: 2px`/`3px`/`5px`, `margin-top: 1px`. A 2px gap between a label and
  its figure is below the smallest token on purpose; `--s-1` is 4px and would
  visibly separate them.
- **The bottom nav**, which is 6 destinations in 358px at 390px wide — 10px
  labels and 5px padding because the tokens do not fit. Measured: the cells are
  58px and the widest label is ~53px.

Radius is `--radius` **10px** by default, `--radius-lg` 16px for panels and
sheets, `--radius-xl` 24px for the largest surfaces, and `--radius-pill` (999px)
for the nav bar, chips and buttons that are round by definition. The single raw
radius in the file is `4px`, on inline `code`.

Measure: `--shell-max` **1280px** for app pages, `--prose-max` **720px** for
long-form.

---

## Chrome

The chrome is a **floating glass pill** pinned to the top of the viewport, not a
sidebar. `.topnav-wrap` is `position: sticky` and paints a gradient from
`--paper` to transparent rather than a hard edge, so content scrolling under the
bar dissolves into the page instead of being sliced by it.

`.topnav` is `grid-template-columns: 1fr auto 1fr`. Links sit in column 1, the
wordmark in column 2, the account/network cluster in column 3, so the brand
stays optically centred no matter how wide either side grows from its own
content.

**The columns are pinned by hand**, and that is load-bearing:

```css
.topnav-links { grid-column: 1; }
.topnav-brand { grid-column: 2; }
.topnav-right { grid-column: 3; }
```

A `display: none` grid item is not a grid item. At 960px `.topnav-links` is
hidden, and without the explicit pins the brand and the controls would slide one
column left — the bar would render as a left-aligned clump with a hole punched
in the right. Naming the columns keeps the middle column the middle column.

At **1080px** the layout changes shape instead: `grid-template-columns: auto 1fr
auto`, the brand moves to column 1 and justifies start, and the links take
column 2 — because a centred wordmark needs room for links either side of it,
and below this width there is not enough.

Mobile navigation is a `.bottom-nav` pill. It sits **before `<main>` in the
DOM** even though it is pinned to the bottom of the screen: DOM order is tab
order, and the other way round a keyboard user had to tab through every link in
the feed — forty of them, on a busy day — before reaching the five destinations
the pill exists to offer. `position: fixed` means the DOM position costs nothing
visually.

Breakpoints are **1180 · 1080 · 960 · 640 · 520**.

---

## Reading modes

The app has two, and they are set differently on purpose.

**The app pages** — feed, markets, portfolio, friends, notifications, asset —
are dense. 14px body, 12px gaps, figures in mono, one card per row, and the
two-column `.grid` collapses to one at 960px.

**The landing, auth, legal and onboarding pages** are long-form prose. The
landing uses `.section` / `.section-head` / `.section-title` / `.section-lede` /
`.section-action` / `.steps` at `--shell-max`; the `.prose` pages use
`.prose-head` / `.prose-section` at `--prose-max`. On a dark background it is
the `--ink`-versus-`--muted` contrast that carries structure, not weight or size.

The landing is the one place allowed its own scale: `.hero-word` is
`clamp(84px, 15vw, 168px)`, and `.scene` / `.scene-rings` are decorative layers
that exist nowhere else.

The hero settles in rather than appearing — `.hero-eyebrow`, `.hero-word`,
`.hero-tagline`, `.hero-body`, `.hero-actions`, `.hero-stats` run the same
`rise 0.75s` with delays from 0.05s to 0.56s. Slow enough to read as one motion,
staggered enough that it is not a single block. Any screenshot tool must
therefore capture with reduced motion, or it will photograph a frame halfway
through and every measurement taken off it will be a lie.

---

## Accessibility

- **Contrast.** Every text pairing is measured above. Body text clears AA
  (4.5:1) on every surface it sits on, and the two filled trade colours use
  dedicated dark ink tokens rather than white.
- **Focus.** `:focus-visible` draws a 2px `--fomo` ring at 3px offset. The app
  previously shipped **no focus style at all** — tab moved focus and nothing
  showed where it went.
- **Native surfaces.** `color-scheme: dark` so scrollbars, form controls and
  autofill are dark. The scrollbar is additionally styled thin and dark: the
  default one is the single brightest thing on the page in a long feed.
- **Motion.** `prefers-reduced-motion: reduce` zeroes animation and transition
  durations globally and forces `scroll-behavior: auto`.
- **Colour is never the only signal.** `.gain` / `.loss` carry a sign (`+` / `−`),
  and a disclosure is marked by its border and background, not by hue alone.

---

## Adding to the system

1. **New colour** → a token in `:root`, and add it to the tables above **with
   its measured contrast ratio**. If it is text, it needs a ratio.
2. **New spacing** → an existing `--s-*`. If it genuinely needs a new step, add
   the step rather than a one-off.
3. **New component** → a block in `globals.css` in render order, with a comment
   saying what it is for. If it needs a one-off hex, that is usually a sign it
   wants a token.
4. **Never write `var(--font-sans)` or `var(--font-mono)` in a declaration.**
   Use `--sans` / `--mono`. See the cycle above.
5. **Inline `style={{}}` should be avoided.** Use a utility class in
   `globals.css` instead — margins, alignment and spacing all have classes. The
   only exception is dynamic values that cannot be expressed in CSS (computed
   widths for the allocation bar, avatar gradients).

### Components and classes added in the redesign

### What the redesign removed

- **`.landing` and `.landing-section`** — the old page wrappers. Neither is
  declared in `globals.css` nor referenced in any `.tsx`; their job is now done
  by `.section` / `.section-head`.
- **The "legacy aliases" block** — `--bg`, `--panel`, `--line`, `--green`,
  `--red`, `--gold`, `--blue`, `--shadow`. It existed so old inline
  `style={{}}` call sites could keep working; those call sites are gone, and
  so are the declarations. Nothing references any of the eight names.

### Classes referenced in JSX

Every landing class used in JSX is defined in the stylesheet:

| Group      | Classes                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| Hero       | `.hero` `.hero-eyebrow` `.hero-word` `.hero-tagline` `.hero-body` `.hero-actions` `.hero-cta` `.hero-stats` `.hero-stat` |
| Sections   | `.section` `.section-head` `.section-title` `.section-lede` `.section-action` `.steps` |
| Ambience   | `.scene` `.scene-rings`                                                    |
| Prose      | `.prose` `.prose-head` `.prose-section`                                    |
| Footer     | `.site-footer`                                                             |

`.steps` uses CSS counters — `counter-reset: step` on the list,
`counter-increment` and `::before { content: counter(step, decimal-leading-zero) }`
on each item — so the counters survive a reorder, which hand-written numbers
would not.

Components:

- **SiteNav** (`components/SiteNav.tsx`) — the chrome for the pages *outside* the
  app: the landing, sign-in, terms and onboarding. It renders the same
  `.topnav` markup as the signed-in shell, so moving between the marketing page
  and the product does not feel like crossing between two sites. That is what
  the old per-page `.hero` header block used to do.
- **AppShell** (`components/AppShell.tsx`) — the floating pill nav, plus the
  mobile bottom nav ordered before `<main>`.
- **NavLinks** (`components/NavLinks.tsx`) — one source of destinations for both
  the pill and the bottom bar.
- **AccountMenu** (`components/AccountMenu.tsx`) — the right-hand cluster;
  surfaces with `--elevated` and `--shadow-lg`.
- **FomoSheet** (`components/FomoSheet.tsx`) — modal on desktop, bottom sheet on
  mobile.
- **PortfolioWidget** (`components/PortfolioWidget.tsx`) — compact portfolio
  summary in the feed's right column.
- **Discover** (`app/(app)/discover/page.tsx`) — trending assets by trade count.
