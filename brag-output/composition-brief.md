# Hyperframes Composition Brief: fobs

## Objective
Create a short launch-style brag video for **fobs** — the social stock market for Solana.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: ~18 seconds

## Source Material
- Project root: `/home/greyw0rks/fobs` (web app at `apps/web`)
- Primary files read: `README.md`, `apps/web/app/page.tsx` (landing), `apps/web/app/layout.tsx` (fonts/theme), `apps/web/app/globals.css` (color tokens), `apps/web/components/fobs/*` (product UI: fomo-card, trade-panel, markets-table)
- Product name: **fobs** (always lowercase in the wordmark)
- Tagline / strongest claim: "The social stock market for Solana." + "It mints nothing, holds no key, and signs nothing."
- Key UI or visual moment to recreate:
  1. The floating white **product card of live prices** (from the landing hero `HeroProduct`) — rounded, rotated ~2°, soft shadow, over a blurred pastel mesh.
  2. The **FOMO loop**: a feed row ("alice just bought SPACEX") with a black **FOMO this** button → a trade panel with an **Amount** field and a black **Confirm** button.
- Copy that must appear verbatim:
  - "Trade what your friends trade."
  - "SOCIAL STOCK MARKET" (eyebrow)
  - "Live prices"
  - "FOMO this"
  - "Mints nothing." / "Holds no key." / "Signs nothing."
  - "the social stock market for solana"
  - "mainnet · your wallet signs"
  - Tickers: NVDA, TSLA, **SPACEX**, **OPENAI**, **ANTHROPIC** (the last three tagged "pre-IPO")

## Creative Direction
- Tone preset: polished
- Creative direction: confident fintech product film with a wink — soft editorial, mainnet-real, restraint as the flex.
- Interpretation: fewer scenes, longer holds, snappy (0.3–0.6s) entrances. Premium and calm; wit comes from the pre-IPO tickers and the "does nothing on purpose" honesty — never from gags or hype.
- Angle: Two flexes at once — (1) you can socially trade names you normally can't touch (pre-IPO SPACEX, OPENAI, ANTHROPIC) next to NVDA/TSLA, all real mainnet tokens; (2) fobs itself mints nothing, holds no key, and signs nothing — the server just builds the swap, your wallet signs. That restraint is the pitch.
- Hook: On the warm canvas with drifting pastel mesh, "Trade what your friends trade." slams in with a green Mainnet pill. Friendly-consumer read; the twist lands in scene 2.
- Outro / punchline: Resolve to the lowercase **fobs** wordmark + "the social stock market for solana" + "mainnet · your wallet signs" — the most trustworthy thing about it is everything it refuses to do.
- Avoid:
  - Generic SaaS language ("streamline your workflow")
  - Abstract filler visuals / generic particle systems
  - Unrelated visual redesign — stay on the actual fobs warm-editorial identity
  - Making the accent blue a CTA (blue is data/links only; CTAs are near-black)

## Visual Identity
- Background: `#f4f3ef` (warm off-white canvas)
- Surface: `#ffffff` cards; hairline border `#e3e2dc`
- Text: ink `#111312`, muted `#777872`
- Accent (data/links/eyebrow only): Fobs Blue `#3175c6`; soft wash `#dceafa`
- Primary CTA / buttons: near-black `#080909` with white text
- Up/Down: green `#23845b` / red `#c94c4c`; soft badges `#dceee5` / `#f5dcdc`
- Soft mesh pastels (blurred background blobs only): blue `#dceafa`, violet `#eadcf5` / `#e9ddf5`, peach `#f5ddd2`
- Display font: **Geist** (semibold, tight tracking ~-0.05em). Self-hosted at `apps/web/app/fonts/Geist.woff2` — copy into composition assets, or fall back to a tight geometric sans (Inter/system) if webfont loading is unreliable in the renderer.
- Body font: **Geist**; ALL numbers/tickers/prices in **GeistMono** (`apps/web/app/fonts/GeistMono.woff2`) with `tabular-nums`. Fall back to a monospace stack if needed.
- Visual references from the project: floating rotated product card; green "● Mainnet" pill; lowercase "fobs" wordmark; black pill/round CTA buttons; soft shadows (`0 30px 80px rgba(0,0,0,.08)`); rounded corners (18–28px).

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. **Hook** — 3s — warm canvas + drifting pastel mesh; eyebrow "SOCIAL STOCK MARKET"; hero "Trade what your friends trade." slams in and holds; small lowercase "fobs" + green Mainnet pill.
2. **The universe (product card)** — 5s — floating rotated white card, "Live prices"; 5 rows reveal one by one: NVDA, TSLA, then SPACEX / OPENAI / ANTHROPIC each tagged "pre-IPO", with mono prices + small green/red badges. Full set holds.
3. **The FOMO loop** — 5s — feed row "alice just bought SPACEX" + black "FOMO this"; cursor clicks it; trade panel slides in with Amount $100 and black Confirm; caption "FOMO doesn't copy. Your size, your signature."
4. **Integrity flex + outro** — 5s — three lines punch in one per every-other beat and hold: "Mints nothing." / "Holds no key." / "Signs nothing."; resolve to large lowercase "fobs" + "the social stock market for solana" + mono "mainnet · your wallet signs"; soft fade.

Total: 18s.

## Audio
- Audio role: warm, confident bed with clean, sparse motion-matched accents.
- Audio arc: music enters under the hook → steady momentum through the ticker + loop reveals with tactile SFX → gentle lift into the three integrity lines → soft fade on the wordmark.
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (~114.8 BPM, warm/business-y). Bed at `data-volume` 0.3–0.35.
- Music treatment: start from track top under the hook; steady presence; soft fade-out under the final wordmark/tagline. No hard stops.
- Music cue guidance: bundled preset available.
  - Preset JSON: `~/.claude/skills/brag/assets/music/cues/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.json` (copy into `composition/assets/music/cues/`).
  - Tempo ~114.8 BPM (beat ≈ 0.52s). Strong cues in window: 1.60, 3.70, 5.80, 6.34, 8.96, 9.50s.
  - Suggested locks (1–3): hero line ≈ 1.60s; FOMO click ≈ a strong beat near the click (~8.96s); wordmark resolve on a later strong cue. Ticker rows ride the beat grid at ~every-other beat (~1.05s) so each label holds ≥0.8s. Integrity lines snap to every-other strong beat, then hold the set.
- Audio-reactive treatment: subtle — use RMS/bass to let the pastel mesh glow/presence breathe and give the product card a soft presence lift. No waveform/equalizer visuals, no strobing, no text scaling that hurts readability. Follow hyperframes-creative's audio-reactive workflow for extraction; if ffmpeg/helper is unavailable, document and skip — do not block the render.
- Audio-coupled moments:
  - Scene 1 hero line — beat-locked reveal (~1.60s).
  - Scene 2 ticker rows — beat-grid sequence, one soft tick per row.
  - Scene 3 FOMO button — simulated cursor click SFX on a strong beat; soft confirm whoosh on Confirm.
  - Scene 4 integrity lines — every-other-beat punches; wordmark lands on a strong cue; music fades under tagline.
- SFX selection guidance (examples, choose after animation exists; prefer low HF-risk, polished restraint):
  - Ticker row ticks: `interface/drop_001`/`drop_002` or `casino/card-place-*` at ~0.5 volume.
  - FOMO click: `ui/mouseclick1` or `interface/click_00x`.
  - Confirm: `impact/impactSoft_medium_00x` (soft) or a gentle `interface/drop_*`.
  - Wordmark resolve: one soft `interface/bong_001` or `impact/impactBell_heavy_000`, brief, at 0.5–0.6.
- SFX analysis guidance: read `~/.claude/skills/brag/assets/sfx/sfx-analysis.md` before choosing; prefer low/medium HF-risk for the repeated ticker ticks.
- Exact SFX choice: Hyperframes chooses filenames, timestamps, density, and volume from the implemented animation. SFX 0.5–0.65 (polished restraint); music ≤ 0.35.
- Audio files: copy the chosen music, cue preset, and any selected SFX into `brag-output/composition/assets/` (relative paths only — never absolute).

## Hyperframes Instructions
Load the composition-building Hyperframes domain skills — `hyperframes-core` (composition contract + `data-*` timing), `hyperframes-animation` (motion), `hyperframes-creative` (design spec, beats, audio-reactive), `hyperframes-keyframes` (seek-safe keyframes), and `hyperframes-cli` (lint/check/render). /brag is its own workflow: do not enter the `hyperframes` entry-point intent interview and do not route into its generic promo / launch-video workflow. Prefer native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show at least one real UI element from fobs (the product price card AND the FOMO loop are both recreated here).
- Keep all text readable in the final render (respect the reading-time floors: hero line holds ~1.8s; short labels ≥0.8s).
- Keep the video within 15–25 seconds (target 18s).
- Include the planned music + SFX layer (audio was not disabled).
- Treat `/brag` audio notes as guidance, not a fixed cue sheet; choose SFX after the visual animation exists.
- Treat music cue metadata as optional timing hints; ignore cues that hurt readability, pacing, or story.
- Use 1–3 strong-cue locks (mark `// beat-locked`); snap sequential ticker rows to consecutive beats (mark `// beat-grid`); use natural timing where a beat would rush a readable line.
- Subtle audio-reactive on the mesh/card presence only.
- Use local assets for audio and fonts; relative paths from `composition/`.
- Run `hyperframes check` before render — the single gate.
