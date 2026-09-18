# Design

The system behind the FOBS interface. Everything here is enforced by
`apps/web/app/globals.css` — this file explains *why* the values are what they
are, so a later change can tell the difference between a decision and a habit.

The interface is a dark trading terminal. Not a dark mode: there is no light
variant, no `prefers-color-scheme` block and no toggle. A light theme would be a
second design rather than a second palette, and the app is honest enough about
being devnet without also being ambiguous about what it is.

---

## Palette

All of these live in `:root`. Nothing outside that block contains a literal hex.

### Surfaces

| Token               | Value     | Used for                                     |
| ------------------- | --------- | -------------------------------------------- |
| `--paper`           | `#0b0d0e` | The page. The darkest thing on screen.        |
| `--sunken`          | `#121517` | Cards and panels — a lift, not a recess.      |
| `--raised`          | `#16191c` | Anything sitting *on* a card: chips, rows.    |
| `--hairline`        | `#1e2427` | The default border.                           |
| `--hairline-strong` | `#2b3236` | Borders that need to be found: inputs, chips. |

Depth is a hairline and one step of surface lightness. There are no shadows
anywhere in the app. The previous stylesheet put a single very large shadow
(`0 18px 50px`) on every card whether or not it floated above anything, which
flattened the page into one plane — every element claimed the same elevation, so
none of them had one.

### Text

| Token     | Value     | Contrast on `--paper` |
| --------- | --------- | --------------------- |
| `--ink`   | `#e8ebe9` | 16.2:1                |
| `--muted` | `#7c8783` | 5.2:1                 |
| `--faint` | `#5c6461` | 3.2:1 — **non-text only** |

`--faint` is deliberately below AA. It carries list counters and separator
marks, never a figure or a label anyone needs to read. If you are reaching for
it to de-emphasise a number, the answer is `--muted`.

### Semantic

| Token    | Value     | Meaning                                    |
| -------- | --------- | ------------------------------------------ |
| `--up`   | `#3ddc84` | A price or position that went up.           |
| `--down` | `#ff5c5c` | A price or position that went down.         |
| `--fomo` | `#f7c948` | The one accent. See below.                  |
| `--info` | `#6ea8ff` | Neutral informational. Dev harness only.    |

### Disclosure

| Token            | Value     |
| ---------------- | --------- |
| `--warn-bg`      | `#2a2205` |
| `--warn-ink`     | `#f5d98a` |
| `--warn-ink-dim` | `#d9c07a` |
| `--warn-rule`    | `#f0a100` |

Amber on near-black, 11.4:1. The disclosure block appears on six pages and is
read once; it has to be legible enough to be read and quiet enough to be
skipped. A saturated fill would make it alarming, and an alarming disclaimer
gets dismissed rather than read.

`--warn-ink-dim` exists because `--muted` is 4.2:1 on `--warn-bg`, which fails
AA. Muted text inside a disclosure uses the amber-tinted approximation instead.

---

## Two rules that are product rules

These are not taste. They are the visual half of things this app says in words,
and both are easy to undo by accident.

### 1. Green and red only ever sit on a figure

`--up` and `--down` are applied to a number that was read off the chain, and to
nothing else. Not a heading, not an icon, not a border used as decoration, and
not a button background standing in for "go".

The reason is that this build spends a lot of copy telling people not to read
things into its numbers — *"price not read"*, *"not enough trades to chart yet"*,
*"nothing is worth anything"*. If the interface also used green as a generic
accent, the colour would mean nothing wherever it does carry meaning.

The consequence worth knowing: **the primary button is near-white, not green**,
and the Buy/Sell toggle is the only place a trade colour fills a control,
because there the colour *is* the meaning.

### 2. Never render a figure the indexer did not read

Where a price is absent, the UI says so — `price not read`, an em dash, a stated
count of excluded holdings. It does not render `$0.00`, and it does not
interpolate. This rule lives mostly in the query layer and the calling
components, but the design supports it: there is no "empty value" style that
makes a missing number look like a real one.

---

## Type

Two families, loaded by `next/font` in `app/layout.tsx` and exposed as
`--font-sans` / `--font-mono`.

**Inter** for words. **JetBrains Mono** for every figure, address and signature,
always with `tabular-nums`. The stylesheet previously asked for `Inter` without
anything loading it, so every glyph came from the OS default and a column of
prices did not line up.

| Token     | Size | Used for                                  |
| --------- | ---- | ----------------------------------------- |
| `--t-xs`  | 11px | Chips, definition terms, section markers  |
| `--t-sm`  | 12px | Secondary metadata, `.figures`            |
| `--t-base`| 14px | Body copy in the app                      |
| `--t-md`  | 16px | Landing hero body                         |
| `--t-lg`  | 20px | Card headlines, the order-size input      |
| `--t-xl`  | 28px | Page titles                               |
| `--t-2xl` | 40px | Landing hero headline only                |

Two utility classes carry the mono treatment:

- `.num` — a single figure. Wraps a price, a total, a holder count.
- `.figures` — a whole line of figures. The `1,240.00 USDC · 6.79 shares at
  182.40` line under a feed card's headline, in four places.

Micro-labels — `.chip`, `dt`, `.landing-section h3` — are uppercase with
`letter-spacing`. That is what makes a 11px label read as a label rather than as
small body text.

---

## Space and shape

`--s-1` through `--s-7`: **4 · 8 · 12 · 16 · 24 · 32 · 48**

Every gap in the stylesheet is one of these. There is no 10px, no 18px, no 26px.

**Radius is 4px**, everywhere, with one exception: the live-connection dot is a
circle.

---

## Reading modes

The app has two, and they are set differently on purpose.

**The app pages** — feed, markets, portfolio, friends, notifications, asset —
are dense. 14px body, 12px gaps, figures in mono, one card per row.

**The landing, auth and legal pages** are long-form prose. 760px measure, 15px
at 1.7 line-height, 68ch of body text, and `--ink` reserved for the phrases that
carry the argument while everything else sits in `--muted`. On a dark background
it is that contrast that carries structure, not weight or size.

These five classes — `.landing`, `.hero`, `.hero-body`, `.landing-section`,
`.steps` — were referenced by five pages and defined nowhere until this restyle.
Those pages had been rendering as unstyled browser defaults.

---

## Accessibility

- Body text meets WCAG AA (4.5:1) on every surface it sits on. The computed
  ratios are in the tables above.
- `:focus-visible` draws a 2px `--fomo` ring. The app previously shipped **no
  focus style at all** — tab moved focus and nothing showed where it went.
- `color-scheme: dark` so native controls, scrollbars and autofill render dark
  rather than light-on-dark.
- `prefers-reduced-motion` is honoured globally.
- Colour is never the only signal. `.gain` / `.loss` carry a sign (`+`), and a
  disclosure is marked by its border and background, not by hue alone.

---

## Adding to the system

1. New colour → a token in `:root`, and add it to the table above with its
   contrast ratio. If it is text, it needs a ratio.
2. New spacing → an existing `--s-*`. If it genuinely needs a new step, add the
   step rather than a one-off.
3. New component → a block in `globals.css` in render order, with a comment
   saying what it is for. If it needs a one-off hex, that is usually a sign it
   wants a token.
4. Inline `style={{}}` is for layout only — `marginTop`, `textAlign`, `flex`.
   Anything that sets a colour or a typeface belongs in the stylesheet, or it
   will not follow the next palette change.

### The legacy aliases

`:root` ends with a small block mapping the old light-theme names onto the new
values — `--bg`, `--panel`, `--line`, `--green`, `--red`, `--gold`, `--blue`,
`--shadow`.

These exist for one reason: the restyle was CSS-only, and some JSX refers to
these names directly in inline styles that the stylesheet cannot reach. They are
aliases, not a second palette. **Anything written from scratch should use the
semantic name**; the block should shrink as those call sites are cleaned up, and
disappear when it is empty. `--shadow: none` in particular is a no-op that keeps
the old `box-shadow: var(--shadow)` declarations harmless.
