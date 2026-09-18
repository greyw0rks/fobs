use anchor_lang::prelude::*;

/// Per-asset USDC reserve. This PDA owns the vault's USDC token account and is
/// the mint authority for the synthetic share mint, so both the reserve and the
/// supply are controlled by program-derived signatures rather than a keypair.
#[account]
pub struct AssetVault {
    pub asset: Pubkey,
    /// Cached mirror of the vault USDC token account balance, kept for cheap
    /// reads. The token account is the source of truth.
    pub usdc_reserve: u64,
    /// Total synthetic shares ever minted minus burned.
    pub shares_outstanding: u64,
    pub bump: u8,
}

impl AssetVault {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 1;
    pub const SEED: &'static [u8] = b"vault";
}
