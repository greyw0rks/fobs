use anchor_lang::prelude::*;

use crate::state::Protocol;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeArgs {
    /// Reserve asset mint. USDC on devnet.
    pub usdc_mint: Pubkey,
    pub spread_bps: u16,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = Protocol::LEN,
        seeds = [Protocol::SEED],
        bump
    )]
    pub protocol: Account<'info, Protocol>,

    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
    let protocol = &mut ctx.accounts.protocol;
    protocol.admin = ctx.accounts.admin.key();
    protocol.usdc_mint = args.usdc_mint;
    protocol.asset_count = 0;
    protocol.spread_bps = args.spread_bps;
    protocol.bump = ctx.bumps.protocol;
    Ok(())
}
