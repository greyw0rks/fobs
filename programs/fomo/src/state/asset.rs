use anchor_lang::prelude::*;

/// Where an asset's price comes from.
///
/// Verified 2026-09-18: on devnet the newest on-chain account for every Pyth
/// US-equity feed was days old (NVDA 23d, MSFT 78d), while the same feeds on
/// mainnet were seconds old. The feeds are not broken — they are simply not
/// published to devnet. So all five assets run on `Mock` there, and the variant
/// exists so mainnet is a config flip rather than a rewrite.
/// See docs/PYTH_VERIFICATION.md.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PriceSource {
    Pyth,
    Mock,
}

#[account]
pub struct Asset {
    pub id: u16,
    pub symbol: [u8; 8],
    /// Synthetic share mint. The vault PDA holds mint authority.
    pub mint: Pubkey,
    /// Vault PDA that custody the USDC reserve and signs mints/burns.
    pub vault: Pubkey,
    /// Expected price identity, interpreted per `price_source`:
    ///   - `Pyth`: the 32-byte Pyth feed id. The caller passes whichever
    ///     `PriceUpdateV2` account it likes and `pyth` verifies the account's
    ///     embedded feed id matches this, because Pyth account addresses are
    ///     shard-derived and not stable to hardcode.
    ///   - `Mock`: unused; the MockOracle PDA is derived from the asset.
    pub price_feed: Pubkey,
    pub price_source: PriceSource,
    /// Decimals of the synthetic mint. Matches USDC's 6 so a share priced at
    /// $178.24 is `178_240_000`.
    pub decimals: u8,
    /// Monotonic per-asset counter, used to derive unique receipt PDAs.
    pub trade_count: u64,
    pub bump: u8,
}

impl Asset {
    pub const LEN: usize = 8 + 2 + 8 + 32 + 32 + 32 + 1 + 1 + 8 + 1;
    pub const SEED: &'static [u8] = b"asset";
}
