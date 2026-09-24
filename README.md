<div align="center">

# fobs

### The social stock market for Solana.

**See what your friends are trading. Take the same position — as a real swap your own wallet signs.**

[**→ fobshq.vercel.app**](https://fobshq.vercel.app)

</div>

---

fobs turns trading into a feed. Follow people, watch the trades they actually
make land in real time, and take your own position in the same asset with one
tap. Every symbol is a real token that already trades on Solana mainnet — listed
equities and pre-IPO names, brought together in one place.

**fobs is a bridge, not an issuer.** It mints nothing, burns nothing, and holds
no key. It routes you into markets that already exist and wraps them in a social
layer. The single most important thing about fobs is what it *cannot* do: it
cannot hold your funds, and it cannot sign for you.

## The loop

```text
  see someone you follow trade
              │
              ▼
        FOMO their trade  ──▶  your own on-chain swap, your size, your signature
              ▲                          │
              └──── appears in their feed ┘
```

FOMO is **not** copy-trading. It pre-fills the asset and suggests an amount; you
choose the size and your own wallet signs your own swap, linked back to the
original. Someone buying $500 and you buying $100 are two independent positions —
you just took the same idea.

## What's real, and who signs

| Piece        | State                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| **Assets**   | Real mainnet tokens. fobs issues none of them.                              |
| **A trade**  | A Jupiter swap, quoted net of the Token-2022 transfer fee.                  |
| **The key**  | Yours. The server builds and forwards the transaction; it never holds one.  |
| **Prices**   | Live — Jupiter routes, Pyth references, and issuer marks, read off mainnet. |
| **Holdings** | Real balances, read from your wallet's own token accounts.                  |

## The asset universe

One list across three real markets, each resolved to a real mint:

- **xStocks (Backed)** — listed equities like `NVDAx`, `AAPLx`, `TSLAx`. Deep
  pools, checkable against a Pyth reference.
- **PreStocks (pre-IPO)** — names like `SPACEX`, `OPENAI`, `ANTHROPIC`,
  `NEURALINK`. Token-2022 mints with a live scaled-supply multiplier and an
  epoch-scheduled transfer fee.
- **Ondo** — tokenized equity, priced honestly and never the silent answer to a
  bare ticker when its pools are thin.

## Two things fobs refuses to do

- **Route a dislocated price.** Two issuers of the same underlying can disagree:
  `NVDAx` tracks its Pyth reference within tens of basis points, while a thin
  pool can imply hundreds of dollars off a real reference — a liquidity artifact,
  not a price. A deviation guard runs before every listed swap and **refuses the
  dislocated route.** Freshness is three states, not a boolean, so a Friday-close
  reference stays usable over a closed weekend instead of rejecting good trades.
- **Dress up a bad round trip.** Pre-IPO marks are read net of the transfer fee,
  and the surface sorts what you can actually act on first — it never calls a
  discount an opportunity when the round trip eats it.

## The social layer

- A live feed of real trades from the people you follow, each linked to its
  on-chain transaction signature.
- Follows, friends, and notifications when your people move.
- A **Fobs buying** signal on every market — how many distinct real accounts
  hold the asset, never an invented number.
- Profiles with a bio, custom links, and connected-account badges.

## Signing in

Sign in with **X** or **Google** for a social identity. To place a trade you
connect your own browser wallet — Phantom, Solflare, or Backpack. Because the
server holds no key, social identity and trading authority are deliberately
separate: an account gives you a place in the feed; a connected wallet is what
signs a swap.

## Built with

Next.js (App Router) and React, deployed on Vercel · Solana web3.js and the
wallet adapter · Jupiter for routing · Pyth for reference prices · Prisma over
Postgres for the social graph and the trade index. Sessions are opaque database
rows, so being signed in never requires a signing secret.

## Disclosure

fobs issues none of these tokens and deploys no program of its own. Tokenized
equity carries real risk, and pre-IPO tokens may not be recognized by the
underlying companies. fobs is a medium into existing markets — the trading, the
issuance, and the custody all live where the tokens already do. Never send funds
anywhere expecting fobs to hold them.
