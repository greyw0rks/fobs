# Bounty plan — PreStocks × Pyth, routed

**Status:** agreed 2026-09-20. Submissions close **Fri 25 September, 4:00pm ET**.

This supersedes the "until the single-trade loop is reliable onchain" cut line in
[HANDOFF.md](../HANDOFF.md), which named PreStocks, Meteora, Tessera and agents as
out of scope. That condition is now met, so the line has expired on its own terms.

---

## The eligibility insight

fobs' synthetics are **listed** equities — `sNVDA`, `sAAPL`, `sMSFT`, `sTSLA`,
`sAMZN` (`scripts/devnet-bootstrap.ts:49-54`). PreStocks' exclusivity clause forbids
integrating any non-PreStocks **pre-IPO** token. Listed-equity synthetics are not
pre-IPO tokens, so the two asset classes do not compete.

| Class | Assets | Source | Pricing |
|---|---|---|---|
| **Synthetic** (exists) | sNVDA, sAAPL, sMSFT, sTSLA, sAMZN | fobs mints, vault PDA | Pyth — already wired |
| **Routed** (new) | SPACEX, OPENAI, ANTHROPIC, ANDURIL, KALSHI, NEURALINK, POLYMARKET, FIGUREAI | PreStocks tokens via Jupiter | PreStocks API |

The product is one app across the whole equity surface, public and private.

> **Confirm this reading with PreStocks before submitting.** The plan rests on one
> sentence of their rules and it is theirs to interpret.

## Bounty matrix

| Track | Prize | Status | Gap |
|---|---|---|---|
| **Pyth** | 3mo Pyth Pro | Strongest | Deviation guard — **done**. Mainnet reads, no flip needed |
| **PreStocks** | $10k, 3 slots | Strong, narrower | Adapter + premium surface — **analysis, not execution**. See the cluster decision |
| **Stocklana pool** | $100k | Strong | The whole app |
| **Meteora** | $5k | Stretch | Real DBC config work — a different build |
| ~~Tessera~~ | $6k | **Excluded** | Integrating it forfeits PreStocks |
| ~~Clawpump~~ | $5k | Skip | Bounty text unverified |

**The PreStocks claim is narrower than it looks.** "Routing" is not something this
app can claim: it cannot sign a mainnet swap. What it does instead is read
PreStocks' market, price it against the issuer's own mark net of the transfer
fee, and refuse to call a discount a discount when the round trip eats it. That
is a real integration and the bounty text should be checked against it before
submitting — see the cluster decision below.


**Tessera is excluded deliberately.** It lists SpaceX, OpenAI and Kalshi — three of
PreStocks' eight. The two bounties compete for the same companies, and the
exclusivity clause is aimed exactly at this.

## Verified facts

All established against mainnet on 2026-09-20, not taken from documentation.

**The tokens exist and route.** All eight mints exist at slot 448831496, owner
`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`. Jupiter returns live quotes:
SPACEX via Meteora DLMM, NEURALINK and OPENAI via Manifest.

**Every mint is Token-2022** with `scaledUiAmountConfig`, `transferFeeConfig`,
`permanentDelegate`, `pausableConfig`, `confidentialTransfer`, and an authorised
`transferHook` (currently `null`).

**Two multipliers are live.** SpaceX ×5 (effective 2026-06-10), OpenAI ×1.4861347
(effective 2026-07-17). Confirmed exactly:

```
SpaceX  raw 8742.506753069 × 5          = 43712.533765345 = API supply
OpenAI  raw 1901.878196904 × 1.4861347  =  2826.447183592 = API supply
```

The API reports **scaled** supply. A raw balance priced at the API's per-unit price
is wrong by the multiplier — 5× on SpaceX.

**The transfer fee doubles at epoch 1039.** Observed schedule:

```
olderTransferFee  epoch 1032 →  50 bps
newerTransferFee  epoch 1039 → 100 bps, maximumFee = u64::MAX
```

Chain was at epoch 1038. The fee is read from the epoch schedule, never hardcoded.

**Jupiter's quote is venue-dependent, and undocumented.** Simulated both ways —
`outAmount` vs the destination account's actual delta:

| Token | Venue | Quoted | Received | Ratio |
|---|---|---|---|---|
| SPACEX | Meteora DLMM | 164,594,745 | 164,594,745 | 1.000000 |
| NEURALINK | Manifest | 225,174,983 | 224,049,108 | 0.995000 |
| OPENAI | Manifest | 59,782,447 | 59,483,534 | 0.995000 |

Vault-side deltas confirm the fee is charged in all three cases at exactly 0.5000%,
matching `olderTransferFee`. Jupiter nets it on Meteora and not on Manifest.

**Consequence:** `otherAmountThreshold` derives from the same gross quote, so tight
slippage does not protect a user from the transfer fee.

**The venue set is not stable, so the netting table is not the mechanism.**

Three calibration runs on the same day routed the same tokens through different
venues each time — `GoonFi V2` + `Quantum`, then `HumidiFi` + `Deriverse` +
`Hadron`, then `BisonFi`. Jupiter's routing moves as liquidity does.

This matters more than any individual row. What keeps a quote honest is not the
per-venue table (`quote.ts`'s `VENUE_NETTING`, three entries) but the
`UNKNOWN_VENUE` default of `gross`, which over-subtracts on anything unmeasured.
The safe direction is the primary mechanism and the table is a refinement.

Confirmed on single-leg routes: `Manifest` grosses (withheld exactly 50.0bps, model
off by 0.0000%), `Meteora DLMM` nets, `Hadron` nets.

**Netting is a property of the venue, not the direction.** Both directions were
measured. The fee is genuinely charged on a sell — SPACEX: seller debited
399,999,673 base units, pool credited 397,999,674, so 0.5000% withheld — but
whether the *quote* already reflects that is per-venue, and the two venues that
produced an unambiguous single-leg reading in both directions agreed with
themselves:

```
NEURALINK   sell  Meteora DLMM  quoted 0.2753  received 0.2753   nets
POLYMARKET  sell  Manifest      quoted 9.1357  received 9.0900   gross
```

`Hadron`'s sell entry stays a conservative default — measured on a buy only, and
inferring the sell from its own buy row would be a guess wearing a measurement's
clothes.

**Selling needed a holder, and the obvious source is closed.** A simulation runs
against current state, so a sell needs a wallet that already holds the token.
`getTokenLargestAccounts` is unavailable on every public endpoint tried —
`publicnode` refuses indexed requests without a personal token, `api.mainnet-beta`
returns 429 for that method while answering everything else, and the rest want an
API key. The way in: the mint is a party to every transfer of itself, so
`getSignaturesForAddress` on the mint lists recent trading, and each transaction
parsed names counterparties and balances. `getTokenAccountsByOwner` then confirms
one holds the mint. Neither call is restricted.

Candidates are tried until one simulates, because discovery cannot distinguish a
wallet from a pool authority — a pool holds the token too and cannot sign. The
runtime answers that, not a heuristic. Failed candidates are reported with their
reason, and most are `InvalidAccountForFee`: a holder with tokens but no SOL.

**The dislocation surface is small, volatile, and mostly untradeable.** Read live
at epoch 1038 with a 1% round trip:

```
SPACEX     discount  gross -22.07%  net edge +21.07%
FIGUREAI   discount  gross  -2.55%  net edge  +1.55%
POLYMARKET discount  gross  -1.49%  net edge  +0.49%
NEURALINK  premium   gross +31.18%  net edge +30.18%   (not tradeable long-only)
OPENAI     premium   gross +12.85%  net edge +11.85%   (not tradeable long-only)
```

Two things this settles. **The largest number is not the tradeable one** —
NEURALINK carries the biggest dislocation in the market and this app cannot act
on it, so sorting by magnitude alone puts an untradeable row above a live
discount. And **the count moves on its own**: two reads minutes apart gave 1-of-8
and then 3-of-8 actionable, with FIGUREAI crossing from premium to discount in
between. Any copy that hardcodes a number will be wrong within the hour.

At epoch 1039 the round trip doubles to 2%, which removes POLYMARKET and
FIGUREAI without a single price changing.

## Build phases

**Phase 1 — data layer** *(done)*
- `apps/web/lib/server/prestocks.ts` — endpoint adapter, scaled-supply documented
- `apps/web/lib/server/token2022.ts` — mint policy, epoch fee, measured multiplier

**Phase 2 — quote layer** *(done)*
- `lib/server/quote.ts` — `quoteSwap` returns what the destination actually
  receives; `quotedOutAmount` kept alongside so the difference is inspectable
- `scripts/calibrate-venues.ts` — simulation-based calibration, `pnpm calibrate:venues`
- Both directions measured. Netting is a property of the venue, not the direction.

**Phase 3 — premium surface** *(done)*
- `lib/server/premium.ts` — `premiumSurface()`, sorted actionable-first
- `scripts/premium.ts` — `pnpm premium`, prints the live surface
- `grossPremium = tokenPrice/markPrice − 1`; `netDislocation = |gross| − roundTripCost`
- `actionableLong` requires a **discount**. The app is long-only, so a premium is
  reported as a fact about the market and never as an opportunity. Print `|gross|`
  rather than the signed premium throughout: for a buyer, more negative is
  better, and the signed form reads as the opposite.

**Phase 4 — UI** *(done)*
- `app/(app)/prestocks/page.tsx` — the surface, rendered live. Actionable rows
  first, the round trip on every row, a "could not read" state instead of an
  empty table, and three disclosures (cannot trade this / not shares / the mark
  is not a bid).
- The positions half is a **`?wallet=` lookup, not the viewer's own wallet** —
  see the cluster decision. Reading the signed-in wallet against mainnet has
  exactly one possible answer, because every key this app custodies is on devnet,
  and printing it would dress a structural boundary up as a quirk. Verified live
  on a real holder: 0.42526 SPACEX from 0.085052 raw at ×5.0000, so a portfolio
  that priced the raw balance would report $10.18 where the page shows $50.90.
- `lib/server/prestocks-positions.ts` + `scripts/positions.ts` (`pnpm positions
  <WALLET>`) — a wallet's holdings priced through `toScaledAmount`, showing both
  raw and scaled units plus value before and after the exit fee.
- Nav link under "Pre-IPO"; `MOBILE_LINKS` drops it and `/portfolio`, because the
  mobile pill's five are places you can act and this one is read-only.
- `scripts/check-prestocks.ts` (`pnpm check:prestocks`) — asserts on request
  counts, not just outcomes. See the endpoint note below.

**Phase 5 — Pyth centrality** *(done)*
- `lib/server/pyth-reference.ts` — the reference price, and the three-state
  freshness classification that makes it usable
- `lib/server/deviation.ts` — the guard. `checkDeviation()` refuses a route when
  the venue's implied price drifts from the reference
- `lib/server/routed-equities.ts` — xStocks and Ondo, pinned and re-validated
- `scripts/pyth-guard.ts` (`pnpm pyth:guard`) — live, two issuers
- `scripts/check-pyth.ts` (`pnpm check:pyth`) — 10 assertions, the refusal path

**Phase 6 — submission** (no cluster work; see the cluster decision)
- `docs/SUBMISSION.md` — submission text, both tracks, live numbers *(done)*
- README + ARCHITECTURE reconciled: PreStocks moved out of "deliberately not
  built" to the routed read-only surface it actually is *(done)*
- Remaining: demo video, then submit before Fri 25 Sep 4pm ET
- Verified 2026-09-21: `typecheck` clean, `check:pyth` 10/10, `check:prestocks`
  5/5, `build` passes. Epoch is now 1039 — round trip 2%, SPACEX the only
  actionable row, exactly as the plan predicted at the flip.

## The Pyth problem: a reference that is 46 hours old is usually still right

Pyth's US equity feeds stop when the market does. Measured on Sunday
2026-09-20, all five mainnet feeds were **46 hours old** — the last publish was
Friday's close:

```
NVDA $222.51   AAPL $334.82   MSFT $493.95   TSLA $364.17   AMZN $254.16
all 46h, market_next_open 2026-09-21T13:30Z
```

And the venues track them anyway. `pnpm pyth:guard` that evening:

```
NVDA  reference $222.52  last close, 46h old
  Backed  NVDAx   ok          $222.33   -8bps      Raydium CLMM
  Ondo    NVDAon  DISLOCATED  $616.49   +17705bps  Manifest  (64% impact)
AAPL  Backed AAPLx  ok  $335.71  +27bps
MSFT  Backed MSFTx  ok  $498.40  +90bps
TSLA  Backed TSLAx  ok  $365.13  +26bps
AMZN  Backed AMZNx  ok  $254.30   +5bps
```

So the guard a naive reading produces — *refuse any reference older than Pyth's
own 90-second bound* — **refuses every good trade from Friday's close to
Monday's open**. That is not a safety feature, it is an outage with good
intentions, and it would have been invisible in weekday testing.

`freshness` is therefore three states, not a boolean:

| state | meaning | verdict |
|---|---|---|
| `live` | published within 90s | use it |
| `closed` | older, but the market is shut and the feed is younger than any closure | last close — usable, **and labelled** |
| `stale` | older, and the market is open — or older than any closure could explain | no reference |

`pnpm check:pyth` asserts all of this, including that a long-weekend-old
reference stays usable and that one beyond any closure stops being a reference
rather than becoming a permissive one.

## The guard works, and here is the trade it refuses

Running two issuers is the point, not a flourish. Same underlying, same moment:
NVDAx at $222.33 and NVDAon at $616.49. Both listed, both Token-2022, both
routable. **Only one is a price.**

Ondo's own documentation says liquidity comes from NASDAQ and NYSE with
near-zero slippage — true of its mint/redeem rail, but Jupiter routes on-chain
pools, and Ondo's Solana NVDA pool holds almost nothing. The tell is the implied
price scaling with trade size:

```
  $10 probe  -> $597.50 implied   62.9% impact
  $100       -> $616.49 implied   64.1% impact
  $1000      -> $1,466.42 implied 84.9% impact
  $5000      -> $4,947.34 implied 95.5% impact
```

That is not a dislocation in a market; it is the absence of one. A surface that
showed a price for both issuers, with nothing to say which was which, would be
worse than showing neither.

## Discovery by ticker is a trap

Jupiter's token search returns memecoins for any ticker. Searching `NVDA` on
2026-09-20 returned, in order, `Next Value Dog Asset`, `Nonstop Voluptuous
Digital`, and only then the real NVIDIA xStock — all three with symbol `NVDA`,
all three Token-2022. `MSFT` returned `Meowcrosoft`.

So mints are **pinned**, and re-validated on every read against the issuer's own
metadata host (`xstocks-metadata.backed.fi`, `cdn.ondo.finance`). Names, symbols
and mint prefixes are free to anyone; only the issuer can serve its own logo.

## Rate limits, everywhere, and none of them are retried into

Every endpoint this app touches throttles. All measured 2026-09-20:

| endpoint | limit | what fixed it |
|---|---|---|
| prestocks.com (Vercel) | ~3 req / 20s per IP, sticky | no retry on 429; 60s cache |
| Jupiter token search | 5 sequential, then sticky 429 | **batch all mints into one `query`** |
| mainnet `getProgramAccounts` | 429 on the 5th back-to-back read | cache the on-chain read; space them |
| Jupiter quote | not observed to throttle | — |

The lesson that generalises: **a 429 is an instruction, and retrying it deepens
the penalty.** The only correct responses are to stop asking, and to ask for less.
Batching the mint lookup took ten calls to one, which is what actually solved it.


## The PreStocks endpoint rate-limits, which is a design constraint

Measured 2026-09-20, and it changes what the adapter is allowed to do. The
endpoint sits behind Vercel, which returns 429 after roughly three requests in a
twenty-second window **per IP** — and the penalty is sticky, observed outliving
the burst that caused it by at least twenty seconds.

Two things follow, both counter-intuitive:

- **A 429 is never retried.** It is the one failure that gets *worse* when you
  ask again. The first version of the adapter retried it like a timeout, which is
  the wrong instinct: a timeout is silence and worth repeating, a 429 is an
  instruction.
- **The cache TTL is a rate-limit budget, not a freshness knob.** It was 15s;
  at one request per fifteen seconds a single process can hold a penalty open
  indefinitely. It is 60s now.

`pnpm check:prestocks` guards this. It passes only if a 429 costs exactly one
request and the next call touches the network zero times.

Separately, the endpoint intermittently returns records with `tokenPrice` and
`supply` nulled. A minority drop is warned and the rest of the market stands; a
majority drop **throws**, because rendering one name out of eight as though it
were the market is a claim about the market made by our own outage.


## Cluster decision — nothing signs on mainnet

**Superseded 2026-09-20.** An earlier version of this section said *"mainnet for
the routed half; devnet for the synthetic half"* and called it "zero funds at
risk". That is not implementable, and the reason is worth writing down because it
is easy to reason past.

The claim was that routing needs no program deployed, so it is free. But a swap
still needs a **signer with funds on the cluster it settles on**. This app's
wallets are devnet:

- `lib/server/custody.ts` holds user keypairs server-side and signs as them. Its
  own doc: *"On devnet, where nothing is worth anything, that is acceptable. It is
  not acceptable for a product holding real value."*
- `lib/server/devnet-only.ts` default-denies that machinery in a production build.
- Neither `NEXT_PUBLIC_USDC_MINT` nor the fobs program exists on mainnet.

And a single cluster is not a preference here, it is structural. There is exactly
one `browserRpcUrl()` and one `connection()`; the wallet adapter uses the former
to answer *"is this wallet connected to the right cluster"*. One endpoint, one
answer. Point it at mainnet and the synthetic half breaks; point it at devnet and
no mainnet transaction can be signed. The two halves cannot run side by side in
one app, because they cannot agree on what cluster they are on.

So:

| | Cluster | Mode |
|---|---|---|
| **Synthetic half** — sNVDA, sAAPL, … | devnet | read **and write** — this is where the app signs |
| **Routed half** — PreStocks, xStocks, Ondo | mainnet | **read only** — no signature, ever |
| **Pyth reference** | mainnet | read only |

**The routed half is market intelligence, not execution.** It quotes Jupiter,
reads PreStocks marks, and verifies both against Pyth. It never signs, so it
needs no wallet, no custody and no funds — which is why it is safe. What it must
never do is imply a trade the app cannot place.

Consequences to state in the submission rather than let a judge discover:

- The PreStocks bounty claim is **integration and analysis, not trading**. We
  surface their market and check it against a reference; we do not route an order.
- The synthetic program stays on devnet. Deploying it to mainnet would mean a
  funded vault minting synthetic equity with real money — a securities question,
  not an engineering one, and PreStocks' own "not available in the U.S., to U.S.
  persons" disclaimer is the tell.
- `market-prices.ts` already documents the mirror of this: devnet publishes no
  usable Pyth equity feed (0/5), so the synthetic half prices from a mock oracle
  while the routed half reads real Pyth. The two halves are honest about
  different things, and the app should say which is which.


## Non-goals

- No Tessera, Ventuals, or any non-PreStocks pre-IPO token — **audit the asset list before submitting**
- No fobs-issued pre-IPO synthetics
- No Token-2022 migration of the on-chain program
- No Clawpump unless an API key returns 200 on `GET /api/v1/pump-pairs`

## Day plan

| Day | Deliverable |
|---|---|
| Sun 20 | Phase 1 — adapters, multiplier + epoch-fee math, tested |
| Mon 21 | Phase 2–3 — quote netting calibrated, premium surface |
| Tue 22 | Phase 4 — UI, scaled balances, risk disclosure |
| Wed 23 | Phase 5 — deviation guard, issuer comparison surface |
| Thu 24 | Demo video, README, submission text |
| Fri 25 | Buffer. **Submit before 4pm ET.** |

## Risks

**Legal.** On 2026-05-11 Anthropic stated that unauthorised transfers of its stock
"is void and will not be recognized on our books and records", naming SPVs and
tokenized securities; OpenAI issued a parallel warning. Both tokens fell sharply.
PreStocks promised third-party attestation at launch and has not published one.

**Liquidity is thin.** Anthropic pools held roughly $333k in stablecoins; quiet-day
volume near $100k. A premium against a shallow book is partly a liquidity artifact,
so price impact is surfaced rather than buried.
