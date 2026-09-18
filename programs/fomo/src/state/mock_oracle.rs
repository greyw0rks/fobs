use anchor_lang::prelude::*;

/// Admin-pushed price for assets whose real feed is unusable.
///
/// This exists because of a verified constraint, not as a shortcut: the newest
/// on-chain account for every Pyth US-equity feed on devnet was days old
/// (NVDA 23d, MSFT 78d), while the same feeds on mainnet were seconds old. The
/// feeds are not broken, they are not published to devnet. Every synthetic
/// asset therefore prices from here on devnet. The trading instruction cannot
/// tell the difference between this and a Pyth account; both resolve through
/// `pyth::read_price`.
#[account]
pub struct MockOracle {
    pub asset: Pubkey,
    /// USD per share, 6dp.
    pub price: u64,
    pub updated_at: i64,
    pub bump: u8,
}

impl MockOracle {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 1;
    pub const SEED: &'static [u8] = b"mock_oracle";
}
