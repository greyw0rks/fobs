use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod pyth;
pub mod state;

use instructions::*;

declare_id!("Fomo9DbW4wbTRSz9eU82Tp1HH27LQJPUYZzcZoSKonxL");

/// FOBS: the social stock market for Solana.
///
/// Four instructions carry the product:
///   initialize     - one-time global config
///   register_asset - create the asset, its mint, and its vault
///   fund_vault     - seed a vault's USDC reserve so sells can settle
///   trade          - buy or sell, emitting a TradeReceipt
///
/// `set_mock_price` is oracle administration, not part of the trading loop.
/// Portfolio-FOMO is deliberately absent; the P0 product is trade-FOMO.
#[program]
pub mod fomo {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        instructions::initialize(ctx, args)
    }

    pub fn register_asset(ctx: Context<RegisterAsset>, args: RegisterAssetArgs) -> Result<()> {
        instructions::register_asset(ctx, args)
    }

    pub fn fund_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
        instructions::fund_vault(ctx, amount)
    }

    pub fn set_mock_price(ctx: Context<SetMockPrice>, price: u64) -> Result<()> {
        instructions::set_mock_price(ctx, price)
    }

    pub fn trade(ctx: Context<Trade>, args: TradeArgs) -> Result<()> {
        instructions::trade(ctx, args)
    }
}
