use anchor_lang::prelude::*;

/// A user's position in one synthetic asset. Created lazily on first trade.
#[account]
pub struct Holding {
    pub owner: Pubkey,
    pub asset: Pubkey,
    /// Shares held, in the asset mint's decimals.
    pub quantity: u64,
    /// Volume-weighted average entry price, in USDC per share (6dp).
    pub avg_price: u64,
    pub bump: u8,
}

impl Holding {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1;
    pub const SEED: &'static [u8] = b"holding";
}
