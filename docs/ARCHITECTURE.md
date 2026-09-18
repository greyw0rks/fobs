# Architecture

## The product is one loop

```text
X  →  see someone trade  →  FOMO their trade  →  execute your own onchain trade
                                                                      ↓
                                          appear in their feed  ←──────┘
```

Everything below exists to make that loop work. Anything that does not serve it
is either deferred or a separate integration track.

## The vertical slice

P0 is the slice, not the individual features:

```text
X identity → social feed → Alice's trade → FOMO → Solana transaction
          → TradeReceipt → Grey's trade → social feed
```

## Responsibility split

| Layer            | Owns                                                              |
| ---------------- | ----------------------------------------------------------------- |
| X                | Identity and the social graph. Nothing else.                     |
| Postgres         | Feed, follows, profiles, notifications, FOMO events.             |
| Solana           | Assets, vaults, holdings, receipts. Only what must be verifiable. |
| Pyth / MockOracle | Price input. Per-asset, chosen from measurement.                 |

Social state is not onchain. There is no compelling reason to pay for consensus
on a follow, and doing so would make the feed slower and worse.

## FOMO is not a copy

This is the invariant the product is built on, and it is worth being precise:

- A FOMO records that *Grey was inspired by Alice's trade*. That is all it
  encodes, and it is stored as its own `FomoAction` row.
- The resulting trade is **Grey's own**. Grey chooses the size, signs it, and
  gets their own `TradeReceipt`. If Alice bought $500 and Grey FOMOs with $100,
  those are two unrelated positions.
- `TradeReceipt.source_receipt` records provenance. It is not an instruction to
  copy anything, and it confers no custody over anyone's position.

There is no copy-trading custody system, no proportional allocation, and no
manager-follower relationship. This is what keeps the product clean, and it is
why portfolio-FOMO was cut: it is the feature that would have required all of
that machinery.

## Price layer

`read_price` is the only place price origin is visible:

```text
                  read_price()
                       |
              +--------+--------+
              v                 v
            Pyth            MockOracle
              |                 |
              +--------+--------+
                       v
               normalized 6dp price
                       v
                    trade()
```

The trading instruction does not branch on source. Each asset declares its own.

**Which source is active is a measured decision, not a design one.** On devnet,
0/5 Pyth US-equity feeds are usable; on mainnet, 5/5 are. All five assets run on
`Mock` for devnet, and each carries a verified `pythFeedId` so mainnet is a
registration argument rather than a program change. Full numbers and method:
[PYTH_VERIFICATION.md](./PYTH_VERIFICATION.md).

The UI labels the active source per asset. A days-old price under a "Pyth" badge
would be the exact disclosure failure this product is defined against.

## Onchain model

```text
Protocol ── usdc_mint, spread_bps, asset_count
    │
    └── Asset ──── mint (vault is mint authority)
         │         price_feed + price_source
         │         trade_count  (drives unique receipt PDAs)
         │
         ├── AssetVault ── USDC reserve, shares_outstanding
         ├── Holding ───── per (owner, asset) position
         └── TradeReceipt ─ the verifiable primitive
```

Instructions:

| Instruction      | Purpose                                                   |
| ---------------- | --------------------------------------------------------- |
| `initialize`     | One-time global config                                    |
| `register_asset` | Creates the asset, its mint, and its vault                 |
| `fund_vault`     | Moves USDC into the reserve so sells can settle            |
| `trade`          | Buy or sell; emits a `TradeReceipt`                        |
| `set_mock_price` | Oracle administration, not part of the trading loop        |

`trade` performs real token movement: USDC transfers for both sides, `mint_to`
on buy, `burn` on sell, all signed by the vault PDA. The vault is the mint
authority, so issuance is program-controlled rather than held by a keypair.

Two details that exist for solvency reasons:

- Buys price at oracle + spread, sells at oracle − spread. That spread is the
  only revenue the vault takes.
- On sell, the payout is recomputed from the shares actually burned rather than
  the requested notional. `quantity` is floored, so paying the requested amount
  would overpay by up to one base unit on every sell.

## Postgres model

`users`, `assets`, `trades`, `holdings`, `follows`, `fomo_actions`,
`notifications`. The feed is the follow graph and nothing more:

```sql
SELECT * FROM trades
WHERE "userId" IN (SELECT "followingId" FROM follows WHERE "followerId" = $1)
ORDER BY "createdAt" DESC;
```

A smarter ranking can come later. An elaborate recommendation engine cannot be
justified before the basic loop is reliable.

`trades.isDemo` defaults to **true** and only becomes false when a real Solana
signature backs the row, so a simulated trade can never be presented as onchain
by accident.

## Deliberately not built

These are separate products or separate integration tracks, and building them
before the core loop works would have been the main risk to shipping:

- **Portfolio-FOMO** — requires the custody machinery described above. Cut.
- **PreStocks** — its rules conflict with a synthetic-asset universe, so it
  would need its own asset universe rather than being jammed into this one.
- **Meteora DBC** — solves market-based price discovery. FOBS needs
  deterministic execution against a known reference price. Different problem.
- **Tessera** — plausible extension of the same social primitive, but a separate
  market.
- **Clawpump / agents** — that is an AI-trading-agent product. Post-MVP.

## Repo layout

```text
fobs/
├── apps/web/              Next.js app, API routes, demo store
│   ├── app/               Feed, asset, profile, portfolio
│   ├── components/        FeedCard, TradePanel, Shell
│   ├── lib/server/        store.ts, demo-data.ts
│   └── prisma/            schema.prisma
├── programs/fomo/         Anchor program
│   └── src/
│       ├── instructions/  initialize, register_asset, fund_vault, trade, set_mock_price
│       ├── state/         asset, vault, holding, trade_receipt, mock_oracle, protocol
│       ├── pyth.rs        price resolution
│       └── errors.rs
├── scripts/               verify-pyth-feeds.ts, seed-demo.ts
└── docs/                  ARCHITECTURE.md, PYTH_VERIFICATION.md
```

## Known gaps

Stated plainly, because they affect what the demo actually demonstrates:

- **The Anchor program has never been compiled.** No Rust/Anchor toolchain was
  available in the build environment (no `rustc`, and no `cargo`/`cc`/`make` for
  linking). It is written to be built, not verified-built.
- **No transaction has touched Solana.** The web loop runs against an in-memory
  store; every trade is labelled demo data.
- **`verify-pyth-feeds.ts` is real** and was run — its output is what
  PYTH_VERIFICATION.md records.
