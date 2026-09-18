use anchor_lang::prelude::*;

/// Global, one-time configuration. `initialize` creates the single PDA at
/// seeds `[b"protocol"]`.
#[account]
pub struct Protocol {
    pub admin: Pubkey,
    /// The SPL mint used as the vault reserve asset (USDC on devnet).
    pub usdc_mint: Pubkey,
    /// Number of assets registered so far. Also the next asset id.
    pub asset_count: u16,
    /// Spread charged on top of (buy) / below (sell) the oracle price.
    pub spread_bps: u16,
    pub bump: u8,
}

impl Protocol {
    pub const LEN: usize = 8 + 32 + 32 + 2 + 2 + 1;
    pub const SEED: &'static [u8] = b"protocol";
}
