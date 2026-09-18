# Handoff

Living status of the FOBS build. Sections are checked off as they are actually
verified — not when the code is written. Anything unverified is marked as such.

**Last updated:** 2026-09-18

---

## Where this stands

The Anchor program **compiles, deploys, and passes its full suite against a real
validator** — 9/9, with token balances asserted against the program's own
accounting rather than just checking that instructions return `Ok`. It is
deployed to devnet with five tradable assets.

The **revised P0 loop runs against devnet, verified end to end**:
`pnpm smoke:loop` signs a real transaction as Alice, indexes the receipt back off
the chain, notifies Bob (who follows her), has Bob FOMO the trade at his own
size, and confirms Alice is notified and both trades appear in the feed. Every
row it checks was written by reading a receipt account — nothing in the app
invents a trade.

The **revised P0 is complete**: landing page, X login, wallet onboarding, friends
and following, real devnet trading, a real-time trade feed and real-time
notifications. `pnpm build` and `pnpm typecheck` are clean, every route renders,
and `pnpm rehearse` walks the whole demo path over the HTTP surface the browser
uses — real sessions, real SSE, a sell as well as a buy, feed pagination, each
hardening guard, and a per-user filter check that a broadcast would fail. What
it cannot see is layout, hydration and re-rendering; that click-through is the
one item still open. See "Remaining".

Since that pass, the build also has: a **portfolio** page reading the program's
own `Holding` accounts (mirrored into Postgres by the indexer — see "Data layer"),
an **asset chart** plotted only from indexed trade prices, holder counts and
"people you follow own this", **feed pagination**, a **people search**, a
**terms and disclosure page**, an **explicit onboarding step** with the custody
disclosure on it, and **hardening**: rate limits on every state-changing route,
sign-out as a POST, and a session requirement on the `/dev` harness.

⚠️ **Wallet onboarding holds user keys on the server.** That is a devnet-only
decision, documented at the top of `lib/server/custody.ts`, and it is the first
thing to replace if this ever stops being devnet. The user is now told this on
`/welcome`, before the key exists.

```bash
pnpm dev              # web app
pnpm build:program    # build the .so and refresh the IDL + TS types
pnpm test:onchain     # local validator, deploy, verify bytecode, run the suite
pnpm devnet:bootstrap # devnet: mint, protocol, five assets, prices, reserves
pnpm devnet:users     # devnet: create and fund the four test users
pnpm seed:db          # seed assets/users/follows into the local database
pnpm db:verify:dev    # exercise that database through the app's own read models
pnpm smoke:loop       # the Alice → Bob FOMO loop, against devnet
pnpm smoke:onboard    # a new X user gets a real, funded, tradable wallet
pnpm rehearse         # the whole demo path over HTTP, as the browser walks it
pnpm devnet:verify    # re-derive every PDA from the IDL and read the chain
```

`pnpm smoke:loop` and `pnpm smoke:onboard` call the same library functions the
API routes call. `pnpm rehearse` goes one layer up: real routes, real session
cookies, two users watching each other over a real SSE connection — so it also
covers session handling, request validation and per-user event filtering, which
the library-level tests cannot reach. It needs `pnpm dev` running.

`pnpm build:program` and `pnpm test:onchain` are the supported path; read the
headers of `scripts/build-program.sh` and `scripts/test-onchain.sh` before
replacing them with `anchor build` / `anchor test`, which fail here in two
non-obvious ways (Sharp edges 1, 8 and 9).

---

## Toolchain

All user-level, no sudo. Paths are not on `PATH` by default — export them:

```bash
export PATH="$HOME/.cargo/bin:\
$HOME/.local/bin:\
$HOME/.local/share/solana/install/active_release/bin:$PATH"
```

| Tool | Version | Location |
|---|---|---|
| rustc / cargo | 1.98.1 | `~/.cargo/bin` |
| Solana CLI (Agave) | 4.2.2 | `~/.local/share/solana/install/active_release/bin` |
| Anchor CLI | 0.30.2 | `~/.local/bin/anchor` |
| SBF platform-tools | v1.54 (rustc 1.89.0-sbpf) | `~/.cache/solana/v1.54` |

`build-essential`, `libssl-dev`, `libudev-dev` were installed via sudo.

---

## Completed and verified

### Toolchain and build

- [x] Rust, Solana CLI, Anchor CLI installed at user level
- [x] **The program compiles.** `cargo-build-sbf --arch v3` →
      `target/deploy/fomo.so` (~317 KB). This was the headline blocker; it had
      never been compiled.
- [x] Root `Cargo.toml` workspace added — Anchor needs a workspace manifest
      beside `Anchor.toml`, and there was none.
- [x] `idl-build` feature added to `programs/fomo/Cargo.toml`; without it the
      build succeeds but emits no IDL.
- [x] **Program ID is real and deployable.** The old `Fomo1111…` placeholder
      decoded to a valid 32-byte key but is **off-curve, so no keypair can exist
      for it** — it could never have been deployed. Replaced with a ground
      vanity keypair, `Fomo9DbW4wbTRSz9eU82Tp1HH27LQJPUYZzcZoSKonxL`, propagated
      into `declare_id!`, `Anchor.toml`, and the IDL.
- [x] IDL generated (`target/idl/fomo.json`) with PDA seeds and program
      addresses resolved; TS types at `target/types/fomo.ts`.
- [x] `scripts/build-idl.mjs` — a documented stand-in for the Anchor CLI's IDL
      step, which cannot run on this machine (see Sharp edges).

### Program correctness

- [x] Two compile errors in `pyth.rs` fixed:
      - `pubkey!` macro expands to crate-relative `solana_program` paths, which
        fail when that crate is not a direct dependency → replaced with
        `Pubkey::new_from_array([...])`.
      - A borrow-checker lifetime error from deserialising through a temporary
        `AccountInfo` → now deserialises straight from borrowed bytes, **with an
        explicit owner check** that `Account::try_from` used to provide.
- [x] Trade math verified by 200k-round-trip simulation: the reserve stays
      solvent, including the sell-payout fix (paying `quote_payout` of the shares
      actually burned, not the requested notional).
- [x] **`register_asset` could not advance the asset counter.** `protocol` was
      not marked `mut`, and Anchor silently drops the write-back for a
      non-writable account, so `asset_count` stayed at 0 and the *second*
      registration collided with the first one's PDA — surfacing as
      `ConstraintSeeds` on `asset`, two steps away from the cause.
- [x] **The suite passes against a real validator: 9/9.** Every case asserts the
      tokens that actually moved against the program's own accounting
      (`vault.usdc_reserve` vs the vault's real USDC balance), which is the
      failure mode that matters for a vault.
- [x] `scripts/test-onchain.sh` dumps the deployed program and diffs it against
      `target/deploy/fomo.so` before running, so "the program disagrees with my
      test" can be answered directly instead of by inference.

### Price layer

- [x] Pyth feeds verified by measurement, not assumption —
      `docs/PYTH_VERIFICATION.md`. **0/5 equity feeds are usable on devnet**
      (NVDA 23d stale, MSFT 78d); **5/5 are fresh on mainnet** (8–16s).
      Decision follows the measurement: mock on devnet, real Pyth ids retained
      for mainnet.

### Data layer

- [x] Prisma schema exercised against the live database — `pnpm db:verify:dev`.
      It imports the app's own read models (`listFeed`, `listNotifications`,
      `getPortfolio`, …) rather than re-writing their queries: the earlier
      version duplicated the feed query, so it could pass while the query the
      app ran was broken, and it had in fact been broken since the schema was
      rewritten while this line still claimed otherwise. A check that cannot
      fail for the right reason is worse than no check.
- [x] `scripts/dev-schema.mjs` generates the SQLite dev schema from the Postgres
      one by rewriting only the provider line, so the two cannot drift.
- [x] The `Holding` mirror is asserted, not assumed: every row belongs to a
      wallet that has traded that asset, none was written as a blank position,
      and the portfolio total equals the sum of its priced positions. That last
      one is the honesty rule made testable — a total that quietly omits a
      position whose price was never read is the failure this catches.

### Web loop

- [x] P0 loop runs: feed → FOMO → independent trade → receipt.
- [x] Feed filtered by the follow graph (`Following` ⊂ `For You`).
- [x] A FOMO is a `Trade` with a `sourceTradeId`, not a separate record — so it
      cannot drift from the trade it produces, and the size is always the
      FOMOer's own. There is no copy-the-trade path to disable.
- [x] No demo mode. The `isDemo` flag is gone: every trade in the feed is a real
      devnet transaction, and the app has no state in which it renders fake ones.
- [x] Honest labelling: price source shown per asset, "synthetic" disclosure in
      the UI and on every asset page.

### Scope discipline

- [x] Five assets, not seven: `sNVDA sAAPL sMSFT sTSLA sAMZN`
- [x] Four core instructions only: `initialize`, `register_asset`, `fund_vault`,
      `trade` (`set_mock_price` exists only because devnet has no live Pyth feed)
- [x] Portfolio-FOMO program and the `PortfolioFollow` table removed — cut, not
      deferred-and-half-built

---

## Devnet

Live and verified against the chain, not against the script that wrote it.

| | |
|---|---|
| Program | `Fomo9DbW4wbTRSz9eU82Tp1HH27LQJPUYZzcZoSKonxL` |
| Test USDC mint | `C7NSuj58YR6aEupcxKXjNRkC8LMZ9jrbKWF75n4ptVDg` |
| Admin / upgrade authority | `BdDxDMDj2iFQ8CDt3n2rcHcgmrdbZ7f15zQSm5Ao1M5R` |
| Spread | 50 bps |

Five assets registered (`sNVDA sAAPL sMSFT sTSLA sAMZN`), each with a mock price
and a 100,000 test-USDC reserve. `pnpm devnet:verify` re-derives every PDA from
the IDL and reads the chain, so "the bootstrap says it worked" and "the chain
agrees" stay distinguishable.

`pnpm devnet:bootstrap` and `pnpm devnet:verify` are both idempotent; addresses
are cached in `.devnet/` (gitignored — it holds real keypairs).

---

## The revised P0

The revision changed what the test environment has to be: not a fake feed with
trading bolted on, but a small real social network — several devnet users
generating real transactions, with the others receiving real-time activity. The
data model follows from one rule:

> The source of truth for a trade is the blockchain. Postgres is the searchable,
> social representation of it.

```
Solana → indexer → Postgres → feed API → UI → SSE
```

Nothing in the app writes a `Trade` from user input. The indexer is the only
writer, and it writes only what it read from a receipt account.

### Built and verified

- [x] **Prisma foundation.** Schema reshaped for the revision: `Asset` carries
      its onchain id and every derived address; `Trade.onchainReceipt` is the
      idempotency anchor with a nullable `txSignature`; `Notification` is
      `type`/`actorUserId`/`tradeId`/`assetId` (no stored message text);
      `Session` added; `FomoAction` **removed** — a FOMO is fully described by
      the trade it produced, so a third record of it would only be something
      else to keep in sync.
- [x] **Test users are real.** Four keypairs (grey, alice, bob, charlie) holding
      real devnet SOL and 25,000 test USDC each, funded from the admin wallet
      rather than by airdrop — devnet throttles airdrops hard enough that a
      four-user run routinely fails halfway, and a half-funded user looks
      exactly like a broken trade path later.
- [x] **Real trade construction.** `lib/solana/trade.ts` replaces the
      `new Transaction()` placeholder with an actual `program.methods.trade(…)`,
      including the share-ATA creation the program requires before a first buy
      (it declares `owner_shares` as a plain `TokenAccount`, not
      `init_if_needed`).
- [x] **The indexer.** Reads each asset's monotonic `trade_count`, fetches only
      the receipt PDAs it has not seen, and upserts on the receipt address.
      The cursor lives on `Asset.indexedTrades` so it advances in the same
      transaction as the trades it accounts for. A missed pass is therefore
      self-healing — the next one finds the gap. Logs could not give that: a
      dropped log line is gone.
- [x] **Notifications are derived, not stored as prose.** `FRIEND_TRADE` to
      followers, `TRADE_CONFIRMED` to the trader, `FOMO` to the author of the
      source trade. Message text is rendered from type + actor + asset, so
      wording changes need no migration and a notification cannot disagree with
      the trade it describes.
- [x] **The loop passes on devnet.** `pnpm smoke:loop` — Test A (Alice buys, Bob
      is notified), Test B (Bob FOMOs at $60 against Alice's $250, and the test
      asserts the sizes differ), Test C (Alice is notified, the feed shows both).
      Two real signatures, both indexed from their receipts.
- [x] **`Holding` is mirrored from the chain, not accumulated from trades.**
      The indexer reads the program's own `Holding` PDA for every wallet that
      has traded an asset and upserts it into Postgres. It deliberately does
      *not* recompute `quantity` or the volume-weighted `avg_price` from the
      trade history: the program already maintains both, and a second
      implementation in TypeScript would be the first thing to drift from it.
      Reading the chain also means existing wallets backfill for free rather
      than showing an empty portfolio until they trade again.

### Remaining on the critical path

All seven of the revised P0 are built and verified. What follows is what was
done, in the order it had to be done.

- [x] `GET /api/events` — SSE over the in-process bus (`lib/server/events.ts`),
      filtered per user, with heartbeat and replay on reconnect.
- [x] Feed API reading Postgres, with `For You` / `Following` / `Markets` tabs
      (`lib/server/queries.ts`).
- [x] Session cookie. No `middleware.ts`, and that is deliberate: the `(app)`
      layout does **not** redirect a signed-out visitor, because the spec is
      explicit that the product opens on the feed rather than on a sign-in wall.
      The routes that need an identity (trade, FOMO, follow, notifications)
      check for one themselves.
- [x] X OAuth2 with PKCE, and the dev sign-in fallback when `X_CLIENT_ID` is
      unset. The fallback is unreachable in production twice over: the route
      refuses on `devSignInAllowed()`, and it will only ever sign in as a user
      flagged `isTestUser`.
- [x] Landing page at `/` (opens on "See what your people are buying", not on
      "Sign in with X"), then `(app)` group with feed, friends, profile,
      notifications, markets.
- [x] `/dev` dashboard — `app/dev/page.tsx` + `components/DevHarness.tsx`,
      reading `POST /api/dev`: chain state per asset, seeded test users with
      trade counts, one-click real trades, and the raw SSE log.
- [x] `TradePanel` wired to the server-signed path, on the asset page and
      through FOMO on every feed card.
- [x] **Wallet onboarding** — `lib/server/onboarding.ts`. See below.

### Wallet onboarding, and what it costs

A user who arrives through X has no wallet, and until this was built nothing in
the app ever wrote `User.walletAddress` — only `seed-db.ts` did. So a real
sign-in produced an identity that could read, follow and be notified, but not
trade: `executeTradeAsTestUser` was the only signing path and it read keypairs
off disk by username.

**The chosen design is server custody, and that is a devnet-only decision.** The
server generates a keypair, seals it with AES-256-GCM under `FOBS_CUSTODY_KEY`,
stores it in `User.walletSecret`, and funds it from the admin wallet. The
alternative — a browser wallet adapter — is what a product holding anything of
value must use, and is the first thing to change if this ever stops being
devnet. `lib/server/custody.ts` says so at the top, where someone about to
extend it will read it.

**It happens on `/welcome`, behind a button, and not inside the sign-in
callback.** It used to run silently in the X callback, which meant a keypair the
server controls was created as a side effect of signing in, before the user had
been told anything about custody or devnet. The callback now redirects to
`/welcome` when `walletAddress` is null, and `POST /api/onboarding` creates the
wallet only when someone presses the button on that page after reading what will
exist. The amounts on the page are read from the funding constants, so it cannot
promise a number the funding code does not deliver. Skipping the page is a
legible state, not a broken account: `ensureWallet` is still called lazily from
the trade path, so the cost of skipping is one extra step later.

The pieces:

- `lib/server/devnet-only.ts` — the single `isProduction()` rule, shared by test
  signing and by funding, so the two cannot drift apart.
- `lib/server/custody.ts` — seal/open. Refuses to operate at all when
  `FOBS_CUSTODY_KEY` is unset rather than inventing a key or falling back to
  plaintext: an unconfigured deployment creates *no* wallets, not insecure ones.
- `lib/server/funding.ts` — the admin key and the mint authority, deliberately a
  separate module from custody so a bug in the trade path cannot reach the mint.
  Create-if-missing throughout, so it converges if run twice.
- `lib/server/onboarding.ts` — `ensureWallet` (idempotent) and `signerForUser`.
  The latter is the **single** entry point for both key sources, so no caller
  has to know whether it is holding a seeded or a custodied user.
- Called from `/welcome` (and from `/api/onboarding`), and again lazily from the
  trade path.

`pnpm smoke:onboard` proves it: creates a scratch user, onboards them, and
checks the wallet's SOL and USDC **by reading them back off devnet**, that the
sealed blob opens to the key controlling the stored address, that a second call
is idempotent, and that a user with no wallet cannot sign.

**A flaw found and fixed while building this.** Signing keys were addressed by
*username*. `availableUsername()` makes a collision unlikely, but on a database
reset without reseeding an X handle `alice` could have claimed the name and
reached Alice's keypair — authority derived from a display name. Key material is
now reachable only through `signingKeyFor(user)`, which takes `isTestUser` as a
**required argument** so a caller cannot skip reading the column, and a
non-test user holding the name `alice` now resolves to no key at all. The
gate test asserts exactly that.

---

## The MVP checklist pass — 2026-09-18

The build was run against an 18-section product checklist. One finding was
structural and the rest were gaps; all of them are closed here. Nothing in this
pass touched the Anchor program — the chain was already correct, and everything
below is "read the chain into Postgres, then show it".

### The structural one: `Holding` was never written

`Holding` existed in the schema, the program's own `Holding` PDA held the real
`quantity` and volume-weighted `avg_price`, and **nothing in the app ever wrote
the row**. That single gap failed four separate checklist sections at once:
holding accounting, the indexer's holdings step, the entire portfolio section,
and the acceptance test that asserts a holding updates after a trade.

`lib/server/indexer.ts` now has `syncHoldings(asset)`, and the fix is the
design decision worth remembering: it **reads the onchain account** rather than
accumulating quantity and average price from the trade history. The program
maintains both correctly on buy *and* sell; recomputing them in TypeScript would
be a second implementation of the program's arithmetic and the first thing to
drift. It also backfills every existing wallet for free, which a
replay-the-history approach would have had to earn one trade at a time. Called
from both `indexAsset` and `runIndexer`, each wrapped so a holdings failure
cannot lose the trades that pass indexed.

### What else was missing, and is not now

| | |
|---|---|
| Portfolio | `/portfolio` + `GET /api/me/portfolio`, holdings, totals, allocation, live USDC/SOL balance, own trade history |
| Balances | `lib/server/balances.ts` — read live from devnet on every request, deliberately not cached, because it is what the trade panel refuses a trade against |
| Chart | `components/PriceChart.tsx` — inline SVG, no dependency, plots only indexed trade prices |
| Asset social data | holder count, "people you follow own this", recent FOMO actions |
| Trade UI | USDC balance shown and over-balance buys blocked with the reason; an explicit confirmation panel carrying the fill and the signature |
| Feed | `before` cursor + `nextCursor`/`hasMore`, a "Load more" control, and loading/error/empty states that did not exist at all |
| Friends | `?q=` search over usernames and display names, filtered in SQL |
| Public product | `/terms` — synthetic disclosure, test-USDC disclosure, custody in full, and what FOMO does and does not do |
| Onboarding | `/welcome` + `POST /api/onboarding` — see the custody section above |
| Hardening | `lib/server/rate-limit.ts` on trades, FOMOs, follows, `/dev` and onboarding; `/dev` now needs a session; sign-out is a POST |

Three of those are worth stating as decisions rather than as features:

- **The chart draws nothing below three trades.** A line through two points is a
  claim about a trend that two points cannot support. Above three, the x axis is
  *time*, not trade index, so a quiet week looks like a quiet week and no candle
  is invented for a period in which nobody traded.
- **A portfolio total is either built entirely from real prices or it is
  absent.** A holding whose asset price has not been read contributes `null` to
  its own value, its allocation and the total, and the page reports how many
  holdings were excluded rather than quietly omitting them. A gain computed
  against a guessed price is indistinguishable on screen from a real one, which
  is exactly why it must not be computed.
- **Sign-out is a POST.** It was a link in the nav, so any page on any site could
  end a session with `<img src="…/api/auth/sign-out">`. The GET now returns 405.

### Verified, by running it

- `pnpm typecheck` and `pnpm build` — clean; every route present in the build
  output, including the four new ones.
- `pnpm db:verify:dev` — all green, with new assertions for the holdings mirror
  (no orphaned rows, no blank positions, every open holding has an entry price),
  the portfolio read model (the total equals the sum of its priced positions),
  and the people search.
- `pnpm smoke:loop`, `pnpm smoke:onboard`, `pnpm rehearse` — all green. The
  rehearsal gained four legs: the sell (acceptance Test 5, which had no coverage
  at all), feed pagination, the hardening guards, and the portfolio move.
- By hand over HTTP, with a real session: every page returns 200; `/portfolio`
  renders two real positions with a $7,119 total against a $7,155 cost basis;
  `/asset/sNVDA` draws the chart and counts holders; `/friends?q=al` filters; and
  the onboarding consent path was walked end to end against a scratch user —
  anonymous POST 401, page renders the disclosure, POST creates and funds a
  wallet (0.5 SOL, 25,000 test USDC, no problems).

### Found and fixed while verifying

Three real bugs, all of which had been invisible:

1. **A search for your own name returned "nobody".** The friends page hides the
   viewer from both of its lists, so a query matching only the viewer rendered
   two empty sections with no explanation. `verify-db` now asserts that shape of
   query specifically.
2. **A trade could fail with `Blockhash not found`** on a perfectly good
   blockhash — sharp edge 16, and not a program bug.
3. **The feed's pagination window could be truncated** in the comparison that
   `db:verify` runs, so a check passed on an invalid comparison; it now fails
   loudly instead.

### Still open

- **The human click-through.** Layout, hydration, re-rendering on a live event
  and whether the FOMO form reads as sizing rather than a copy. `pnpm rehearse`
  exists so that anything that goes wrong here is a UI bug, not a plumbing one.
- **Real X credentials** (`X_CLIENT_ID`, `X_CALLBACK_URL`) — two variables, and
  the flow behind them is finished.
- **Pyth on devnet.** Measured, not assumed: 0/5 US-equity feeds are usable on
  devnet, 5/5 are fresh on mainnet. Not a missing integration.

---

## Remaining

### Onchain

Nothing. The program is deployed, `initialize` has run, all five assets are
registered, priced and funded, and `pnpm devnet:verify` confirms it against the
chain rather than against the script that wrote it.

### Web app

The revised P0 is complete and verified (see above). What is not built:

- **Real X credentials.** The OAuth2 + PKCE flow is implemented end to end, but
  `X_CLIENT_ID` / `X_CALLBACK_URL` are not set, so `xConfigured()` is false and
  the sign-in page offers the seeded accounts instead. Two environment variables
  are the whole gap; the page says so rather than pretending.
- **Pyth is configured but not live on devnet.** Assets carry real `PYTH_FEED_IDS`
  and the asset page names the mainnet feed, but no Pyth US-equity feed is
  published on devnet, so prices come from the program's `MockOracle` and every
  surface says so. This is a fact about devnet, not a missing integration.

### Rehearsal

- [x] **The demo path over the HTTP surface the browser uses** — `pnpm rehearse`.
      Landing → two real sessions → Alice trades → Bob's live SSE stream carries
      the notification → Bob FOMOs at his own size → Alice is notified and her
      feed shows Bob. Every step goes through a real route with a real session
      cookie, and it ends with a per-user filter leak test: Bob follows Alice and
      not Charlie, so Charlie's trade must reach Bob's feed (trades are public)
      and must *not* reach Bob's notifications. A broadcast would pass every
      other check here.
      Four more legs were added with the MVP pass: **D** sells part of Alice's
      position and asserts the holding decreased and the USDC came back (the
      acceptance list's Test 5, which had no coverage at all); **E** pages the
      feed with a real cursor and asserts no trade appears on both pages, plus
      that a malformed cursor is a 400 rather than a silent first page again;
      **F** tries each hardening guard that is otherwise invisible — anonymous
      `/api/dev`, `GET /api/auth/sign-out`, and a burst against `/api/trades`.
- [ ] **A human click-through**, for the parts a script cannot see: layout,
      hydration, whether a component actually re-renders when an event arrives,
      and whether the FOMO form reads as sizing rather than a one-click copy.
      `pnpm rehearse` exists so that when you sit down to do this, everything
      underneath is already known to work — anything that goes wrong from here
      is a UI bug.

The old in-memory demo store (`lib/server/store.ts`, `lib/server/demo-data.ts`),
`lib/solana.ts`'s placeholder `buildTradeTransaction`, `/api/portfolio` and the
scripts that fed them (`scripts/seed-demo.ts`, and the first `scripts/verify-db.ts`)
are gone, along with the last route that imported them. Nothing in the repo can
now produce a trade that did not happen on devnet.

---

## Sharp edges

Things that cost time and will cost it again. Do not rediscover these.

1. **`anchor build`'s IDL step cannot run here.** Anchor 0.30.2 shells out to
   `cargo +nightly-2024-01-30` (cargo 1.77) for IDL generation, and the
   dependency tree now resolves `block-buffer 0.12.1`, which requires
   `edition2024`. Cargo 1.77 dies with a misleading *"failed to download
   replaced source registry `crates-io`"*. The pin is historical, not a real
   constraint — `pnpm idl` runs the same command on stable and assembles the
   output. `anchor build` still works for the `.so`; only the IDL step fails.

2. **`ANCHOR_IDL_BUILD_RESOLUTION` must be the literal string `"TRUE"`.**
   anchor-syn compares `val == "TRUE"`, so `"true"` or `"1"` silently disable
   resolution and the IDL comes back with no PDA seeds and no program
   addresses — clients then have to hard-code every PDA.

3. **It is a compile-time `option_env!`.** Setting it on the process is not
   enough once anchor-syn is built, and cargo has no reason to rebuild it.
   `scripts/build-idl.mjs` runs `cargo clean -p anchor-syn` first for exactly
   this reason.

4. **anchor-syn emits fully-qualified type names** (`fomo::state::asset::Asset`)
   via `get_full_path()`. The published IDL uses bare names; the CLI shortens
   them, and `scripts/build-idl.mjs` reproduces that. Client lookups are keyed
   on the bare name, so skipping this breaks `program.account.asset`.

5. **Program addresses are off-curve or on-curve, but must have a keypair to
   deploy.** A vanity string like `Fomo1111…` decodes fine and passes every
   structural check while being permanently undeployable.

6. **pnpm 11 writes placeholder prose into `allowBuilds`** (`set this to true or
   false`) when it detects an ignored build script. A non-boolean silently
   disables the build. This bit the repo twice: once for the whole workspace,
   once for `bigint-buffer`. Check `pnpm-workspace.yaml` after adding deps.

7. **`pkill -f` and `pgrep -f` match the shell that runs them.** The pattern is
   in the invoking shell's own argv, so `pkill -f "next dev"` kills the shell
   doing the killing: the command dies with a bare `Exit code 144` and no
   output. Match the process *name* instead (`pkill -x`), put the pattern in a
   script file, or bracket it (`[n]ext dev`).

8. **`cargo-build-sbf` defaults to `--arch v0`, and agave 4.2.2 will not run
   SBPFv0.** The build succeeds and writes a normal-looking `target/deploy/
   fomo.so`; the failure only appears at deploy time, as *"Detected sbpf_version
   required by the executable which are not enabled"* — a message that never
   mentions the arch flag. Build with `--arch v3` (`pnpm build:program`). To
   check an artifact, read the ELF header: `e_flags` is `3` for SBPFv3 and `0`
   for the unusable default.

9. **A stale IDL turns a program change into a misleading client error.** The
   IDL is what tells the client which accounts are writable. Add `mut` to an
   account in the program without regenerating the IDL and the client keeps
   sending it read-only, so the program fails with `ConstraintMut` — which reads
   like a program bug and is really an artifact-staleness bug.
   `pnpm build:program` always regenerates the IDL and the TS types together.

10. **PDA seed widths must match the Rust field widths.** `asset_count` is a
    `u16`, so `[Asset::SEED, &asset_count.to_le_bytes()]` is a **two**-byte seed,
    while `trade_count` is a `u64` and really is eight. Encoding both as eight
    gives a `ConstraintSeeds` failure showing two equally plausible base58
    addresses. `Left` is the address the client passed; `Right` is what the
    program derived — reading them the other way round sends you looking for a
    non-existent program bug.

11. **`anchor test` attaches to a validator already listening on the RPC port**
    instead of starting its own. If that validator still holds a previously
    deployed program, the suite runs against bytecode unrelated to the source
    you just edited. Use `pnpm test:onchain`, which owns its ledger and diffs the
    deployed program against the artifact it just built.

12. **The IDL `scripts/build-idl.mjs` emits is snake_case** (`source_receipt`,
    `vault_usdc`), because the Anchor CLI's post-processing — which camelCases
    every name — is exactly the step that script stands in for. This is
    harmless through `new Program(idl, provider)`: Anchor calls
    `convertIdlToCamelCase` internally (`program/index.js:103`), so
    `program.methods.trade({ sourceReceipt })` and
    `program.account.tradeReceipt.fetch(…)` both work, which is why the suite
    passes. It breaks the moment you use `BorshAccountsCoder` /
    `BorshInstructionCoder` directly on the raw JSON, since those take the IDL
    verbatim. If that happens, call `convertIdlToCamelCase` yourself rather than
    hand-editing the artifact.

13. **`prisma generate` produces a provider-specific client, and the last one
    wins.** `pnpm db:dev` generates from `schema.dev.prisma` (SQLite);
    `pnpm db:push` would generate from `schema.prisma` (Postgres) and overwrite
    it. The generated client refuses a URL of the other provider, and the error
    arrives as a validation failure at query time, not at startup. After
    switching targets, re-run the matching push script before running anything.

14. **`tsx` does not read `.env.local`.** That file is a Next convention — the
    dev server loads it, a plain script does not, so a script that imports
    `@/lib/prisma` dies with `Environment variable not found: DATABASE_URL`.
    Scripts pass it explicitly: `tsx --env-file=.env.local …` (see
    `smoke:loop` in `apps/web/package.json`).

15. **`pnpm build` and `pnpm dev` share `.next`, and the build wins.** Running a
    production build while the dev server is up leaves the dev server serving a
    chunk graph it did not emit. The symptom is not a build error — it is the
    dev server failing *later*, at whatever route happens to load a missing
    chunk (`Cannot find module './713.js'`, a 500 from `/api/auth/dev`), and it
    can also surface as the dev server running production-compiled modules and
    misbehaving in ways that look like application bugs. A trade once failed
    reproducibly with `Blockhash not found` purely because of this. If you build,
    wipe and restart before trusting anything the dev server says:
    `rm -rf apps/web/.next && ./scripts/dev.sh`.

16. **`api.devnet.solana.com` intermittently rejects a perfectly good blockhash.**
    It is a load-balanced pool, and the node that answers `getLatestBlockhash`
    is not guaranteed to be the node that runs preflight. The simulation then
    runs on a node that has never seen that blockhash and fails with
    `Transaction simulation failed: Blockhash not found` — before anything is
    broadcast. It looks like a program bug and is not one. `execute-trade.ts`
    retries the fetch-sign-send sequence (a new blockhash invalidates the
    signature, so re-sending the same signed transaction cannot help), and
    retries *only* that error: a program error is the program's real answer and
    is thrown on the first attempt. Expect this on any public RPC; a dedicated
    endpoint makes it rare rather than routine.

17. **The generated Prisma client is provider-specific, so a query that is valid
    on one is a *type* error on the other.** `mode: "insensitive"` exists on
    Postgres and not on SQLite, and the SQLite client rejects it at runtime too.
    `DATABASE_URL` decides the provider, the client is generated from whichever
    schema was pushed last (see 13), and TypeScript then sees one provider's
    types. `nameSearch` in `lib/server/queries.ts` branches on the URL *and*
    casts, and both are load-bearing: the branch picks the arguments the running
    provider accepts, the cast is what lets one file compile against either
    generated client. Do not remove the cast as redundant.

18. **`GET` that changes state is reachable from any page on any site.**
    Sign-out was a link in the nav, so `<img src="https://…/api/auth/sign-out">`
    on a third-party page ended the session. It is a POST form now and the GET
    returns 405 with a body saying why. The general rule for this app: anything
    that signs a transaction, writes a row, or ends a session is a POST, and the
    cost of getting that wrong is not a bug report — it is a stranger able to
    spend the operator's devnet SOL through a victim's browser.

19. **A rate limiter that is not `globalThis`-pinned only works in production.**
    Next re-evaluates modules on hot reload, so a module-level bucket map is
    replaced on every save and the limiter silently resets — during development,
    which is exactly when it is being tested, and never in the built app, which
    is exactly when it is not. `lib/server/rate-limit.ts` hangs its map on
    `globalThis` for the same reason `lib/server/events.ts` hangs its listener
    set there: the symptom of getting it wrong is a feature that appears to work
    and does nothing.

---

## Known design wart

`trade`'s `amount` is a **USDC notional on both sides of the book**, so "sell my
whole position" is not directly expressible: the caller has to ask for what the
shares are worth and add one base unit to survive the double flooring. It works,
and the suite does exactly that, but it is the wrong shape for the most common
sell action in the product. The cheap fix when it starts to matter is a `SellAll`
side or an explicit quantity-vs-notional flag. Deliberately not added yet — the
loop is still being proven and this does not block it.

---

## Demo path

Do not open with "sign in with X." Open on the feed — and that is testable, so
`pnpm rehearse` tests it: the landing page's primary call to action is `/feed`,
and `/feed` renders real trades with no session cookie at all.

Two people, two browsers. Alice and Bob are seeded devnet accounts, and they
follow each other:

1. Alice buys $250 of sNVDA on `/asset/sNVDA`. It lands on devnet with a real
   signature.
2. **In Bob's browser, without reloading**, a notification appears on the live
   stream: Alice traded.
3. Bob opens the feed, sees her trade, clicks `[FOMO]`.
4. The form is pre-filled at *half* Alice's size as a suggestion, and Bob
   overwrites it with $60. FOMO means "do this too, in my own size" — the amount
   is never taken from the source trade.
5. Bob's trade is a second, independent devnet transaction at $60, carrying a
   `sourceTradeId` back to Alice's $250.
6. **In Alice's browser, without reloading**, she is told Bob FOMO'd her, and
   her feed shows his trade.

That is the product. Everything else is supporting detail. `pnpm rehearse` walks
exactly this path, plus a check that the per-user event filter is real: Bob
follows Alice and not Charlie, so Charlie's trade must reach Bob's feed and must
not reach his notifications.

Worth showing after that, because each is a claim the build makes and can back
up: `/portfolio` (positions read from the program's own `Holding` accounts, with
the USDC balance read live from devnet), `/asset/sNVDA` (a chart drawn only from
indexed trade prices — no candle for a period nobody traded, and no line at all
below three trades), `/friends?q=al`, and `/terms`, which is where the custody
arrangement is stated in full rather than in a footnote.

---

## Cut line

Portfolio-FOMO, PreStocks, Meteora, Tessera and agents stay cut until the
single-trade loop is reliable onchain. The demo stands on the social feed plus
one FOMO.
