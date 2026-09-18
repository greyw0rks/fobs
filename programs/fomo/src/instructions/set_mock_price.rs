use anchor_lang::prelude::*;

use crate::errors::FomoError;
use crate::state::{Asset, MockOracle, Protocol};

#[derive(Accounts)]
pub struct SetMockPrice<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [Protocol::SEED], bump = protocol.bump, has_one = admin @ FomoError::Unauthorized)]
    pub protocol: Account<'info, Protocol>,

    pub asset: Account<'info, Asset>,

    #[account(
        init_if_needed,
        payer = admin,
        space = MockOracle::LEN,
        seeds = [MockOracle::SEED, asset.key().as_ref()],
        bump
    )]
    pub mock_oracle: Account<'info, MockOracle>,

    pub system_program: Program<'info, System>,
}

/// Admin-only. Price is USD per share at 6 decimals ($178.24 -> 178_240_000).
pub fn set_mock_price(ctx: Context<SetMockPrice>, price: u64) -> Result<()> {
    require!(price > 0, FomoError::InvalidPrice);

    let oracle = &mut ctx.accounts.mock_oracle;
    oracle.asset = ctx.accounts.asset.key();
    oracle.price = price;
    oracle.updated_at = Clock::get()?.unix_timestamp;
    oracle.bump = ctx.bumps.mock_oracle;
    Ok(())
}
