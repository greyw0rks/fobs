use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::FomoError;
use crate::state::{AssetVault, Protocol};

#[derive(Accounts)]
pub struct FundVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [Protocol::SEED], bump = protocol.bump, has_one = admin @ FomoError::Unauthorized)]
    pub protocol: Account<'info, Protocol>,

    #[account(
        mut,
        seeds = [AssetVault::SEED, vault.asset.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, AssetVault>,

    /// The reserve token account, owned (authority) by the vault PDA.
    #[account(
        mut,
        constraint = vault_usdc.mint == protocol.usdc_mint @ FomoError::WrongMint
    )]
    pub vault_usdc: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = admin_usdc.mint == protocol.usdc_mint @ FomoError::WrongMint,
        constraint = admin_usdc.owner == admin.key() @ FomoError::Unauthorized
    )]
    pub admin_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Move USDC into the reserve. This is a real token transfer — the vault's
/// ability to pay out on sells depends on it actually holding the tokens.
pub fn fund_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
    require!(amount > 0, FomoError::InvalidAmount);
    require_keys_eq!(
        ctx.accounts.vault_usdc.owner,
        ctx.accounts.vault.key(),
        FomoError::Unauthorized
    );

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.admin_usdc.to_account_info(),
                to: ctx.accounts.vault_usdc.to_account_info(),
                authority: ctx.accounts.admin.to_account_info(),
            },
        ),
        amount,
    )?;

    let vault = &mut ctx.accounts.vault;
    vault.usdc_reserve = vault
        .usdc_reserve
        .checked_add(amount)
        .ok_or(FomoError::MathOverflow)?;
    Ok(())
}
