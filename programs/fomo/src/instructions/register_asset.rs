use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::errors::FomoError;
use crate::state::{Asset, AssetVault, PriceSource, Protocol};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RegisterAssetArgs {
    pub symbol: [u8; 8],
    pub price_source: PriceSource,
    /// Pyth feed id when `price_source == Pyth`; ignored for `Mock`.
    pub price_feed: Pubkey,
    pub decimals: u8,
}

#[derive(Accounts)]
#[instruction(args: RegisterAssetArgs)]
pub struct RegisterAsset<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// `mut` is load-bearing: the handler advances `asset_count` below, and
    /// Anchor only writes an `Account` back on exit when it is writable. Without
    /// it the increment is silently dropped, the next registration reuses id 0,
    /// and it fails with `ConstraintSeeds` on `asset` rather than anything that
    /// points here.
    #[account(mut, seeds = [Protocol::SEED], bump = protocol.bump, has_one = admin @ FomoError::Unauthorized)]
    pub protocol: Account<'info, Protocol>,

    /// Asset id comes from the protocol counter, so ids are sequential and
    /// cannot collide.
    #[account(
        init,
        payer = admin,
        space = Asset::LEN,
        seeds = [Asset::SEED, &protocol.asset_count.to_le_bytes()],
        bump
    )]
    pub asset: Account<'info, Asset>,

    /// Owns the USDC reserve and is the mint authority for `mint`.
    #[account(
        init,
        payer = admin,
        space = AssetVault::LEN,
        seeds = [AssetVault::SEED, asset.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, AssetVault>,

    /// The synthetic share mint. Created here rather than in a setup script so
    /// the program — not an off-chain keypair — controls issuance.
    #[account(
        init,
        payer = admin,
        mint::decimals = args.decimals,
        mint::authority = vault,
        seeds = [b"mint", asset.key().as_ref()],
        bump
    )]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn register_asset(ctx: Context<RegisterAsset>, args: RegisterAssetArgs) -> Result<()> {
    require!(args.symbol.iter().any(|byte| *byte != 0), FomoError::InvalidSymbol);
    require!(args.decimals <= 9, FomoError::InvalidAmount);

    let protocol = &mut ctx.accounts.protocol;
    let id = protocol.asset_count;

    let asset = &mut ctx.accounts.asset;
    asset.id = id;
    asset.symbol = args.symbol;
    asset.mint = ctx.accounts.mint.key();
    asset.vault = ctx.accounts.vault.key();
    asset.price_feed = args.price_feed;
    asset.price_source = args.price_source;
    asset.decimals = args.decimals;
    asset.trade_count = 0;
    asset.bump = ctx.bumps.asset;

    let vault = &mut ctx.accounts.vault;
    vault.asset = asset.key();
    vault.usdc_reserve = 0;
    vault.shares_outstanding = 0;
    vault.bump = ctx.bumps.vault;

    protocol.asset_count = id.checked_add(1).ok_or(FomoError::MathOverflow)?;
    Ok(())
}
