# FOBS

The social stock market for Solana. Connect X, see what your people are buying,
FOMO their trade, and execute your own onchain.

## The loop

```text
X  →  see someone trade  →  FOMO their trade  →  your own onchain trade
                                                          ↓
                                  appear in their feed  ←──┘
```

FOMO does **not** copy a trade. It pre-fills an asset and suggests an amount. You
size it, you sign it, you get your own receipt. Alice buying $500 and you FOMOing
$100 are two unrelated positions. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run it

```bash
corepack enable pnpm
pnpm install
cp .env.example .env
pnpm dev            # http://localhost:3000
```

No database required. `DEMO_MODE=true` (the default) serves the fixture data from
memory, so the whole loop — feed, FOMO, trade, receipt — runs immediately.

With Postgres (`docker compose up -d && pnpm db:push && pnpm seed`) you can move
the API routes onto Prisma.

## What is real and what is not

Worth reading before a demo, because the gap is load-bearing:

| Piece                       | State                                                          |
| --------------------------- | -------------------------------------------------------------- |
| Web loop (feed → FOMO → trade) | **Works.** Runs against an in-memory store.                 |
| Pyth verification           | **Real.** `pnpm verify:pyth` hits Hermes and mainnet/devnet.    |
| Anchor program              | **Written, never compiled.** No Rust toolchain was available.   |
| Onchain transactions        | **None.** Every trade is labelled `isDemo` and `simulated:`.    |

`trades.isDemo` defaults to true and only flips when a real signature backs the
row, so a simulated trade cannot be presented as onchain by accident. The feed
labels the price source per asset rather than implying live pricing.

## The price layer

Assets are synthetic SPL-style tokens (`sNVDA`), explicitly labelled as such
throughout the UI. FOBS is not a brokerage and settles no real securities.

Prices come from Pyth where Pyth actually works. Measured 2026-09-18:

- **devnet: 0/5** US-equity feeds usable (newest NVDA account was 23 days old)
- **mainnet: 5/5** usable (8–16s old)

So all five assets price from `MockOracle` on devnet while carrying their
verified mainnet Pyth feed ids. Switching is a registration argument, not a
program change. Method and raw numbers:
[docs/PYTH_VERIFICATION.md](docs/PYTH_VERIFICATION.md).

## Asset universe

Five, not seven: `sNVDA`, `sAAPL`, `sMSFT`, `sTSLA`, `sAMZN`.

## Layout

```text
apps/web/        Next.js app + API routes + demo store
programs/fomo/   Anchor program (see docs/ARCHITECTURE.md)
scripts/         verify-pyth-feeds.ts, seed-demo.ts
docs/            ARCHITECTURE.md, PYTH_VERIFICATION.md
```

## Scripts

```bash
pnpm dev            # web app
pnpm typecheck      # tsc --noEmit
pnpm verify:pyth    # re-run the Day 0 feed verification
pnpm seed           # Postgres seed (requires DATABASE_URL)
pnpm anchor:test    # requires the Anchor toolchain
```

## Deliberately not built

Portfolio-FOMO (needs custody machinery the product does not want), PreStocks,
Meteora DBC, Tessera, and agent trading. Each is either a separate product or a
separate asset universe. Rationale in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#deliberately-not-built).
