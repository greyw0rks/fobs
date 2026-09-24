# Brag Plan: fobs

## What is this app?
fobs is the social stock market for Solana — sign in, see what your friends are trading, FOMO their trade, and place your own real mainnet swap that *your* wallet signs. It routes into markets that already exist (Backed xStocks, PreStocks pre-IPO names, Ondo) and bridges them into one social feed. It mints nothing, holds no key, and signs nothing.

## The angle
The flex is **restraint plus reach**. Two things at once:
1. You can socially trade names you normally can't touch — pre-IPO **SPACEX, OPENAI, ANTHROPIC** — right next to **NVDA** and **TSLA**, all real tokens on mainnet.
2. fobs itself does almost nothing on purpose: **mints nothing, holds no key, signs nothing.** The server just builds the swap; your wallet signs. That integrity *is* the pitch.

Specific to fobs, not generic: real tickers, the FOMO loop (which explicitly does **not** copy trades), the warm editorial design, and the "we hold no key" honesty.

## Hook (first 2-3 seconds)
Warm off-white canvas, soft pastel mesh drifting behind. The line **"Trade what your friends trade."** slams in in big Geist type, with a small green **Mainnet** pill. It reads like a friendly consumer app — the twist lands in scene 2.

## Key moments (the middle)
- **The universe card** — a floating white product card lists live prices, and the rows arrive one by one: NVDA, TSLA, then **SPACEX**, **OPENAI**, **ANTHROPIC** tagged *pre-IPO*. Prices in tabular GeistMono, tiny green/red changes. The "wait, you can trade *those*?" beat.
- **The FOMO loop** — a feed row: "alice just bought SPACEX", a black **FOMO this** button. A cursor clicks it; a trade panel slides in with an amount you set and a black **Confirm** button. Caption: "FOMO doesn't copy. Your size, your signature."
- **The integrity flex** — three short lines punch in one per beat: **Mints nothing. Holds no key. Signs nothing.**

## Outro / punchline
Resolve to the lowercase **fobs** wordmark + "the social stock market for solana" and a quiet line: "mainnet · your wallet signs." The punchline is that the most trustworthy thing about it is everything it refuses to do.

## User flow worth showing
entry → key action → result:
1. **See it** — a friend's trade appears in the feed ("alice just bought SPACEX").
2. **FOMO it** — click the black FOMO button; the trade panel pre-fills the asset, you set your own amount.
3. **Sign it** — your own wallet confirms your own swap (not a copy), linked back to the original.
This is the centerpiece (Scene 3). The card in Scene 2 is the frame around it.

## Tone
- Preset: polished
- Creative direction: confident fintech product film with a wink — soft editorial, mainnet-real, restraint as the flex.
- Interpretation: fewer scenes, longer holds, snappy entrances. Clean and premium; the wit comes from the pre-IPO tickers and the "does nothing on purpose" honesty, never from gags.

## Format: landscape — 1920x1080
## Duration: ~18s

## Visual identity (from the project)
- Background: `#f4f3ef` (warm off-white canvas)
- Surface: `#ffffff` cards, hairline border `#e3e2dc`
- Accent (data/links only): Fobs Blue `#3175c6`; soft wash `#dceafa`
- Primary action / CTA: near-black `#080909` (black buttons, never blue)
- Text: ink `#111312`, muted `#777872`
- Up/Down: green `#23845b` / red `#c94c4c` (soft badges `#dceee5` / `#f5dcdc`)
- Soft mesh pastels (background blobs only): blue `#dceafa`, violet `#eadcf5`, peach `#f5ddd2`
- Display font: **Geist** (semibold, tight tracking ~-0.05em)
- Body font: **Geist**; all numbers/tickers/prices in **GeistMono** with `tabular-nums`
- Strongest visual element: the floating white product card of live prices, rotated ~2°, over the pastel mesh; lowercase "fobs" wordmark.

## Share copy (draft)
fobs — the social stock market for Solana. see what your friends trade, FOMO it, sign your own swap. real mainnet tokens (yes, even pre-IPO SPACEX & OPENAI). it holds no key and signs nothing. 🟢 mainnet

## Audio direction
- Role: warm, confident bed with clean motion-matched accents.
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (~115 BPM, upbeat but composed).
- Music treatment: enter under the hook (start from track top or a clean bar), steady presence through the loop, gentle lift into the integrity lines, soft fade on the outro wordmark.
- Music cue guidance: see below.
- Audio-reactive treatment: subtle — let the pastel mesh glow/presence breathe with bass; no waveform bars, no gimmicks.
- SFX posture: sparse and tasteful — a soft tick per ticker row, one click on the FOMO button, one confirm whoosh, one quiet resolve on the wordmark.
- Audio-coupled moments: ticker rows appear on beats; FOMO cursor click matches a strong beat; integrity lines punch one per (every-other) beat; wordmark lands on a strong cue.
- Restraint rule: audio must never rush a readable line off screen or turn this into a hype ad. Polished, not loud.

## Music cue guidance
- Track: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3`, ~114.8 BPM (beat ≈ 0.52s).
- Strong cues in window (from preset): 1.60, 3.70, 5.80, 6.34, 8.96, 9.50s — well distributed, good for reveals across the whole video.
- Target major moments: hero line ≈ **1.60s**; FOMO click on a strong beat ≈ **8.96s**; wordmark resolve on a later strong cue.
- Sequential reveals (ticker rows) ride the beat grid at ~every-other-beat (~1.05s apart) so each short label holds ≥0.8s; the full set then holds on screen.
- Integrity lines snap to every-other strong beat, then hold the set of three.
- Restraint note: cues are optional timing hints; story and readability win over hitting a beat.

## Storyboard

### Scene 1 — Hook — 3s
Warm `#f4f3ef` canvas. Soft blurred pastel mesh blobs (blue/violet/peach) drift slowly, upper right. Tiny lowercase **fobs** wordmark top-left; small green **● Mainnet** pill. Center-left: blue uppercase eyebrow **"SOCIAL STOCK MARKET"**, then the hero line **"Trade what your friends trade."** slams in (Geist semibold, ~-0.065em, two lines) and holds ~1.8s.
Sequential/interaction: none.
Audio intent: warm confident open; music enters and settles.
Audio-coupled idea: hero line lands on the ~1.6s strong beat.
Music: vol-11, from top.
Transition mood: soft crossfade → Scene 2

### Scene 2 — The universe (product card) — 5s
The floating white product card (recreated from the landing hero): rounded, rotated ~2°, soft shadow, over the pastel mesh. Header: **fobs** + green **Mainnet** pill. Label **"Live prices"**. Rows arrive one by one with a soft tick: **NVDA** ·, **TSLA** ·, then **SPACEX** *pre-IPO*, **OPENAI** *pre-IPO*, **ANTHROPIC** *pre-IPO* — each with a mono price (`tabular-nums`) and a small green/red change badge. The pre-IPO tag is the payoff. Full set holds ~1.2s.
Sequential/interaction: yes — 5 rows reveal one by one, beat-aligned (~1s apart); pre-IPO tags emphasized.
Audio intent: momentum building, each arrival feels solid.
Audio-coupled idea: one soft UI tick per row on the beat grid.
Music: steady.
Transition mood: soft slide → Scene 3

### Scene 3 — The FOMO loop — 5s
Product-in-use. A feed row on a white card: avatar + **"alice just bought"** + **SPACEX** chip + amount, with a black **FOMO this** button. A cursor glides in and **clicks** the button (click SFX). A compact trade panel slides in: asset **SPACEX** pre-filled, an **Amount** field showing **$100** (you set it), a black **Confirm** button. Caption beneath, held ~1.5s: **"FOMO doesn't copy. Your size, your signature."**
Sequential/interaction: yes — simulate cursor click on FOMO this, then panel slide + confirm.
Audio intent: crisp, tactile; the click and confirm feel real.
Audio-coupled idea: click on a strong beat (~8.96s); soft confirm whoosh.
Music: steady, slight lift at the end.
Transition mood: clean wipe → Scene 4

### Scene 4 — Integrity flex + outro — 5s
Back to the calm canvas. Three short lines punch in one per (every-other) beat and hold as a set: **"Mints nothing."** **"Holds no key."** **"Signs nothing."** Then they clear and resolve to the large lowercase **fobs** wordmark, tagline **"the social stock market for solana"**, and a quiet mono line **"mainnet · your wallet signs"**. Soft fade.
Sequential/interaction: yes — 3 lines reveal one by one, then hold, then resolve to wordmark.
Audio intent: confident close; a final settle, not a bang.
Audio-coupled idea: each line on an every-other strong beat; wordmark on a strong cue; music fades under the tagline.
Music: gentle lift into the lines, soft fade on wordmark.
Transition mood: soft crossfade → end

**Music mood for this video:** upbeat-but-composed (confident fintech), never hype.
**Audio summary:** A warm ~115 BPM bed opens under the hook, drives beat-aligned ticker and loop reveals with sparse tactile SFX (ticks, one click, one confirm), lifts gently into the three integrity lines, and fades softly on the lowercase fobs wordmark.
