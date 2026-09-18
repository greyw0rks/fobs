use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum TradeSide {
    Buy,
    Sell,
}

/// The verifiable primitive the whole product rests on: proof that this wallet
/// actually executed this trade against this vault.
///
/// A receipt is minted for the FOMOer's own trade too. `source_receipt` records
/// which receipt inspired it, but nothing about the source trade is copied:
/// amount, price and signature all belong to the signer. See docs/ARCHITECTURE.md.
#[account]
pub struct TradeReceipt {
    pub owner: Pubkey,
    pub asset: Pubkey,
    pub side: TradeSide,
    pub amount_usdc: u64,
    pub quantity: u64,
    /// Effective price after spread, USDC per share (6dp).
    pub price: u64,
    pub timestamp: i64,
    /// The receipt this trade FOMO'd, if any.
    pub source_receipt: Option<Pubkey>,
    pub bump: u8,
}

impl TradeReceipt {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 8 + 8 + 8 + (1 + 32) + 1;
    pub const SEED: &'static [u8] = b"receipt";
}
