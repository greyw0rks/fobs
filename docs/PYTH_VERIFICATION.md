# Pyth feed verification (Day 0)

Run `pnpm verify:pyth` to reproduce everything below. Numbers recorded
**2026-09-18**.

## Why this was checked first

The original design document assumed a mixed outcome — NVDA/AAPL/MSFT/TSLA
priced from Pyth on devnet, AMZN falling back to a mock oracle. That assumption
was never verified, and it is load-bearing: `trade()` refuses to execute against
a price older than `MAX_PRICE_AGE_SECS` (90s). If the assumption were wrong, the
first real trade would revert and every downstream task would be blocked.

So the assets were chosen from measurement, not from the document.

## Result

| Symbol | devnet newest account | devnet verdict | mainnet newest account | mainnet verdict |
| ------ | --------------------- | -------------- | ---------------------- | --------------- |
| NVDA   | 23 days               | STALE          | 15s                    | FRESH           |
| AAPL   | 34 days               | STALE          | 8s                     | FRESH           |
| MSFT   | 78 days               | STALE          | 12s                    | FRESH           |
| TSLA   | 14 hours              | STALE          | 10s                    | FRESH           |
| AMZN   | 34 days               | STALE          | 16s                    | FRESH           |

**0/5 usable on devnet. 5/5 usable on mainnet.**

The feeds are not broken. They are simply not published to devnet. This is a
deployment-environment fact, not a data-quality one, and it is the reason the
decision below is a configuration choice rather than a redesign.

## Decision

Register all five assets with `PriceSource::Mock` on devnet. The Pyth code path
stays fully wired and tested-by-inspection for mainnet, where the same feed ids
resolve to live prices. Because `Asset` carries `price_feed` and `PriceSource`
per asset, switching is a registration argument — no program change.

The UI states the active source per asset (`Pyth priced` vs `Demo oracle`) rather
than implying all prices are live. Showing a days-old price under a "Pyth" label
would be the exact disclosure failure the product is trying to avoid.

## Two things that cost time to discover

**1. Pyth account addresses are not derivable from the feed id.**
The obvious guess is `findProgramAddress(["price_feed", feed_id], RECEIVER)`.
That derivation produces `Da4aq7oRn4A4jB6HSz5kASHzUK9JFyFREWhUCF87jf31` for
SOL/USD, which is **not** the real account
(`7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`). Pyth's pull model means anyone
may post a price update, so one feed id maps to many accounts — SOL/USD had
63,894 on devnet. The script therefore filters `getProgramAccounts` on the
`feed_id` field at offset 41 and scans for the highest `publish_time`, which is
the only reliable way to find the *current* price.

**2. Hermes endpoints changed.**
- `GET /v2/updates/price/latest` now returns **401** without an API key
  (the legacy `/api/latest_price_feeds` returns 401 as well).
- `GET /v2/price_feeds` still works unauthenticated. Note `asset_type` is
  **case-sensitive**: `equity` returns 200, `Equity` returns **400**.

Neither affects the on-chain path, which reads accounts directly.

## `PriceUpdateV2` layout

Confirmed by decoding the live SOL/USD account above. Used by
`programs/fomo/src/pyth.rs`:

```text
  0 ..  8   Anchor discriminator
  8 .. 40   write_authority     (Pubkey)
 40 .. 41   verification_level  (u8)
 41 .. 73   feed_id             ([u8; 32])
 73 .. 81   price               (i64)
 81 .. 89   conf                (u64)
 89 .. 93   exponent            (i32)
 93 ..101   publish_time        (i64)
```

`pyth.rs` parses these offsets directly rather than depending on
`pyth-sdk-solana`, so the layout stays auditable alongside the code that reads
it. Swapping in the SDK's `PriceUpdateV2::try_deserialize` is a contained change
behind `read_price`.

## Feed ids (verified)

```text
NVDA  b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593
AAPL  49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688
MSFT  d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1
TSLA  16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1
AMZN  b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a
```

These are stored on each asset as `pythFeedId` even while the active source is
`mock`.

## Still open

- No asset is registered onchain, so the `Pyth` branch has not executed against
  a live mainnet feed. It is written but **unverified at runtime**.
- `MAX_PRICE_AGE_SECS = 90` is sized for the observed mainnet publish cadence
  (~8–16s). It has not been tested across a mainnet outage or a weekend.
