# FOBS

The social stock market for Solana. Sign in, see what your people are trading,
FOMO their trade, and place your own — as a real swap your own wallet signs.

**FOBS is a bridge, not an issuer.** It mints nothing, burns nothing, and holds
no key. It routes you into markets that already exist on mainnet — listed-equity
xStocks, pre-IPO PreStocks, Ondo — and brings them together in one place. Every
trade is a Jupiter swap the browser wallet signs; the server only builds and
forwards it.

Live: **https://web-production-2672d.up.railway.app**

## The loop

```text
see someone trade  →  FOMO their trade  →  your own onchain swap
                                                  ↓
                          appear in their feed  ←──┘
```

FOMO does **not** copy a trade. It pre-fills the asset and suggests an amount.
You size it, your wallet signs it, you get your own position. Alice buying $500
and you FOMOing $100 are two unrelated swaps.

## What is real, and who signs

Everything here is a real mainnet token. The single most important fact is what
FOBS *cannot* do:

| Piece | State |
| --- | --- |
| The assets | **Real mainnet tokens.** NVDAx (Backed), SPACEX (PreStocks), Ondo — FOBS issues none of them. |
| A trade | **A Jupiter swap**, quoted net of the Token-2022 transfer fee, signed by your wallet. |
| The key | **Yours.** The server builds the swap and sends it; it never holds a key and signs nothing. |
| Prices | **Live.** Jupiter routes, Pyth references, PreStocks marks — read from mainnet. |
| Holdings | **Real balances**, read from your wallet's own token accounts. |

Two things FOBS refuses to do, on purpose: it will not route a listed equity
whose venue price has drifted from its Pyth reference (see below), and it will
not call a discount an opportunity when the round-trip fee eats it.

## The asset universe

One list across three markets, each resolved to a real mint. Trade keys:

- **xStocks (Backed)** — bare ticker: `NVDA`, `AAPL`, `MSFT`, `TSLA`, `AMZN`.
  Deep pools, Pyth-checkable.
- **PreStocks (pre-IPO)** — `SPACEX`, `OPENAI`, `ANTHROPIC`, `ANDURIL`, `KALSHI`,
  `NEURALINK`, `POLYMARKET`, `FIGUREAI`. Token-2022 with a live scaled-supply
  multiplier and an epoch-scheduled transfer fee, both read off-chain.
- **Ondo** — `NVDA-ondo` etc. In the universe, but never the silent answer to a
  bare ticker: its Solana equity pools are thin, and the guard says so.

### The Pyth guard, at execution

Two issuers of the same underlying, same moment: NVDAx tracks Pyth within tens
of bps; NVDAon implies ~$617 against a ~$224 reference — a shallow-pool artifact,
not a price. `/api/trades/prepare` runs `checkDeviation` before building a listed
swap and **refuses a dislocated route** (HTTP 409). Freshness is three states,
not a boolean, so a Friday-close reference stays usable over a closed weekend
instead of refusing every good trade. See [docs/BOUNTY_PLAN.md](docs/BOUNTY_PLAN.md).

Pre-IPO names have no public reference price, so nothing is checked against an
invented one — the surface states that rather than pretending otherwise.

## Signing in

| Provider | Needs | Can trade? |
| --- | --- | --- |
| **Wallet** | nothing — a signature check | **Yes.** The wallet signs every swap. |
| **X** | `X_CLIENT_ID`, `X_CALLBACK_URL` (OAuth2 PKCE, no secret) | Identity. Connect a wallet to trade. |
| **Google** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | Identity. Connect a wallet to trade. |

Because the server holds no key, X and Google sign you into the *social* layer;
placing a trade requires a connected browser wallet (Phantom, Solflare,
Backpack). Sessions are opaque DB rows, so no signing secret is needed.

`X_CALLBACK_URL` and `GOOGLE_CALLBACK_URL` must be publicly reachable HTTPS and
allowlisted in each provider's console:

```
https://<your-domain>/api/auth/x/callback
https://<your-domain>/api/auth/google/callback
```

## Run it locally

```bash
corepack enable pnpm
pnpm install
cp .env.example .env.local     # mainnet RPC + a Postgres/SQLite URL
pnpm db:dev                    # SQLite dev database at apps/web/dev.db
pnpm dev                       # http://localhost:3000
```

The routed reads (Jupiter, Pyth, PreStocks) hit mainnet by default and need no
keys. To trade against them, connect a mainnet wallet with USDC.

## Deploy

Deployed on **Railway** (app + Postgres). The root `Dockerfile` pins the Node
build — the repo also holds an Anchor program, and autodetection otherwise tries
to compile the Rust.

```bash
railway up --service web --detach        # build + deploy
railway logs --service web --build       # build logs
railway logs --service web               # runtime logs
```

`NEXT_PUBLIC_*` are inlined at build time, so they are passed as Docker build
args. `DATABASE_URL` references the Postgres service; the container runs
`prisma db push` on start, then `next start`.

## Scripts

```bash
pnpm dev                 # web app
pnpm typecheck           # tsc --noEmit
pnpm build               # production build

pnpm --filter web check:swap        # quote → build a signable swap (both directions)
pnpm --filter web premium           # the live PreStocks premium surface
pnpm --filter web pyth:guard        # two issuers, one Pyth reference, the refusal
pnpm --filter web check:pyth        # the guard's refusal path + freshness rule
pnpm --filter web check:prestocks   # rate-limit + shape-drop assertions
pnpm --filter web positions <WALLET># a wallet's PreStocks holdings, scaled + fee-adjusted
```

## Layout

```text
apps/web/               Next.js app, API routes, background events
  lib/server/           tradeable registry, quote/swap builder, prestocks,
                        token2022, pyth-reference, deviation, premium, record-trade
  app/api/trades/       prepare (build swap) + submit (send + record)
docs/                   BOUNTY_PLAN.md, SUBMISSION.md, ARCHITECTURE.md, PYTH_VERIFICATION.md
```

## Deliberately not built

FOBS issues no synthetic or pre-IPO token of its own, deploys no on-chain program,
and takes no custody. It is a medium into existing markets — the trading, the
issuance, and the custody all live where the tokens already do.
