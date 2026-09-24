# FOBS — submission

The social stock market for Solana, plus a second equity surface that reads the
private market and checks it against Pyth. Two bounties, one honest boundary
between them.

---

## What to run

```bash
pnpm --filter web pyth:guard      # Pyth track — two issuers, one reference
pnpm --filter web premium         # PreStocks track — the live premium surface
pnpm --filter web check:pyth      # 10 assertions, including the refusal path
pnpm --filter web check:prestocks #  5 assertions, rate-limit + shape drop
```

Every number below is read live from mainnet, not from documentation.

---

## Pyth track — a reference that refuses the wrong price

The point is not that we read a Pyth feed. It is that we run **two issuers of the
same underlying** and the guard rejects the one that isn't a price.

Same NVDA, same moment (`pnpm pyth:guard`):

```
NVDA  ·  reference $224.06 — live, published 11s ago
  Backed  NVDAx    ok          $224.62   +25bps     Riptide
  Ondo    NVDAon   DISLOCATED  $617.51   +17560bps  Manifest  (63.58% impact)
```

Both are listed, both Token-2022, both routable. Only NVDAx is a price. NVDAon's
implied price scales with trade size — a shallow-pool artifact, not a market
dislocation — and the guard says so.

Two design decisions that a weekday demo would hide:

- **Freshness is three states, not a boolean.** US-equity feeds stop when the
  market does. A naive "refuse anything older than Pyth's 90s bound" refuses
  every good trade from Friday's close to Monday's open. `closed` (market shut,
  younger than any closure) stays usable and is labelled; `stale` (market open,
  or older than any closure could explain) yields no reference. `check:pyth`
  asserts both directions.
- **The guard exits non-zero only when nothing could be checked.** A dislocation
  is a finding, not a failure.

Method and raw numbers: [BOUNTY_PLAN.md](BOUNTY_PLAN.md) §"The Pyth problem".

---

## PreStocks track — integration and analysis, not trading

**Eligibility.** FOBS' synthetics are *listed* equities (sNVDA, sAAPL, …).
PreStocks' exclusivity clause forbids integrating a non-PreStocks *pre-IPO*
token. Listed synthetics are not pre-IPO tokens, so the classes do not compete —
and we surface PreStocks' eight pre-IPO names as their own mainnet market rather
than issuing our own. **This reading rests on one sentence of their rules and
should be confirmed with PreStocks before the prize is awarded.**

**Scope, stated up front.** The routed half never signs. This app's wallets are
devnet; a mainnet swap needs a funded mainnet signer. So the claim is
*integration and analysis*, not order routing. We read their market, price it
against the issuer's own mark net of the transfer fee, and refuse to call a
discount a discount when the round trip eats it.

Three things the integration gets right (`pnpm premium`, live):

```
1 of 8 actionable at epoch 1039 · round trip 2.00%

SPACEX     discount clears costs               gross -21.26%  net edge +19.26%
           mark $152.25  token $119.87  ×5.0000000 (measured)
NEURALINK  premium — not tradeable long-only   gross +29.26%  net edge +27.26%
OPENAI     premium — not tradeable long-only   gross +12.67%  net edge +10.67%
```

- **Scaled supply.** Every mint is Token-2022 with a live multiplier (SpaceX ×5,
  OpenAI ×1.486, measured against on-chain config). A raw balance priced at the
  API's per-unit price is wrong by the multiplier — verified against a real
  holder: 0.085052 raw → 0.42526 scaled at ×5, so $50.90 not $10.18.
- **The transfer fee is read from the epoch schedule.** It doubled from 50bps to
  100bps at epoch 1039 — no price changed, but the round trip did, and
  POLYMARKET and FIGUREAI dropped out of "actionable" on the flip alone.
- **A mark is not a bid.** NEURALINK carries the biggest dislocation in the
  market and the app cannot act on it (long-only, no borrow). Sorting by
  magnitude would put an untradeable row above a live discount, so the surface
  sorts actionable-first and never says "opportunity".

---

## The boundary, stated so a judge doesn't have to discover it

| Half | Cluster | Mode |
|---|---|---|
| Synthetic (sNVDA …) | devnet | read **and write** — the app signs here |
| Routed (PreStocks, xStocks, Ondo) | mainnet | **read only** — no signature, ever |
| Pyth reference | mainnet | read only |

The two halves cannot share a cluster: there is one RPC endpoint and one
connection, and the wallet adapter uses it to answer "is this wallet on the right
cluster". Point it at mainnet and the synthetic half breaks; at devnet and no
mainnet swap can sign. This is structural, not a preference — full reasoning in
[BOUNTY_PLAN.md](BOUNTY_PLAN.md) §"Cluster decision".

The synthetic program stays on devnet deliberately: a funded mainnet vault
minting synthetic equity with real money is a securities question, not an
engineering one.

---

## Risks we are not hiding

- **Legal.** Anthropic (2026-05-11) and OpenAI stated unauthorised transfers of
  their stock "will not be recognized"; both tokens fell. PreStocks promised
  third-party attestation and has not published one.
- **Thin liquidity.** A premium against a shallow book is partly a liquidity
  artifact, so price impact is surfaced on every routed row rather than buried.

---

## Verification summary

| Check | Result |
|---|---|
| `pnpm typecheck` | clean |
| `pnpm check:pyth` | 10/10 |
| `pnpm check:prestocks` | 5/5 |
| `pnpm pyth:guard` | 6 checked, 1 dislocation caught (Ondo NVDA) |
| `pnpm premium` | 8 read, 1 actionable at epoch 1039 (SPACEX) |
