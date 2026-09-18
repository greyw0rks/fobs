use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::errors::FomoError;
use crate::pyth::read_price;
use crate::state::{Asset, AssetVault, Holding, Protocol, TradeReceipt, TradeSide};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TradeArgs {
    pub side: TradeSide,
    /// USDC notional, 6 decimals. `$500` is `500_000_000`.
    pub amount: u64,
    /// The receipt this trade is FOMOing, if any. Recorded for provenance only:
    /// nothing about the source trade is copied, and the signer pays their own
    /// way at their own size.
    pub source_receipt: Option<Pubkey>,
}

#[event]
pub struct TradeReceiptEvent {
    pub owner: Pubkey,
    pub asset: Pubkey,
    pub side: TradeSide,
    pub amount_usdc: u64,
    pub quantity: u64,
    pub price: u64,
    pub source_receipt: Option<Pubkey>,
}

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [Protocol::SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,

    /// Mutable because the receipt PDA is derived from `trade_count`, which
    /// advances once per trade.
    #[account(mut, seeds = [Asset::SEED, &asset.id.to_le_bytes()], bump = asset.bump)]
    pub asset: Account<'info, Asset>,

    #[account(mut, seeds = [AssetVault::SEED, asset.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, AssetVault>,

    /// The synthetic share mint, authority = vault PDA.
    #[account(mut, address = asset.mint @ FomoError::WrongMint)]
    pub mint: Account<'info, Mint>,

    /// Reserve token account, authority = vault PDA.
    #[account(
        mut,
        constraint = vault_usdc.mint == protocol.usdc_mint @ FomoError::WrongMint
    )]
    pub vault_usdc: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = owner_usdc.mint == protocol.usdc_mint @ FomoError::WrongMint,
        constraint = owner_usdc.owner == owner.key() @ FomoError::Unauthorized
    )]
    pub owner_usdc: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = owner_shares.mint == asset.mint @ FomoError::WrongMint,
        constraint = owner_shares.owner == owner.key() @ FomoError::Unauthorized
    )]
    pub owner_shares: Account<'info, TokenAccount>,

    /// Created on first trade. `init_if_needed` is safe here because the handler
    /// guards on `owner == Pubkey::default()` before initialising fields.
    #[account(
        init_if_needed,
        payer = owner,
        space = Holding::LEN,
        seeds = [Holding::SEED, owner.key().as_ref(), asset.key().as_ref()],
        bump
    )]
    pub holding: Account<'info, Holding>,

    /// Unique per trade via the asset's monotonic counter.
    #[account(
        init,
        payer = owner,
        space = TradeReceipt::LEN,
        seeds = [TradeReceipt::SEED, asset.key().as_ref(), &asset.trade_count.to_le_bytes()],
        bump
    )]
    pub receipt: Account<'info, TradeReceipt>,

    /// CHECK: resolved and fully validated by `pyth::read_price`, which checks
    /// the owning program, the embedded feed id, and staleness.
    pub price_account: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn trade(ctx: Context<Trade>, args: TradeArgs) -> Result<()> {
    require!(args.amount > 0, FomoError::InvalidAmount);

    let price = read_price(&ctx.accounts.asset, &ctx.accounts.price_account)?;
    let effective_price = apply_spread(price, ctx.accounts.protocol.spread_bps, args.side)?;
    let quantity = quote_quantity(args.amount, effective_price, ctx.accounts.asset.decimals)?;
    require!(quantity > 0, FomoError::InvalidAmount);

    let asset_key = ctx.accounts.asset.key();
    let decimals = ctx.accounts.asset.decimals;
    // Bound to a local first: `&[bump]` is a temporary and would be dropped at
    // the end of the statement, leaving `signer_seeds` dangling.
    let vault_bump = [ctx.accounts.vault.bump];
    let signer_seeds: &[&[u8]] = &[AssetVault::SEED, asset_key.as_ref(), &vault_bump];

    // What actually moved. Equal to `args.amount` on buys; on sells it is
    // recomputed from the burned shares and may be a base unit lower.
    let mut settled_amount = args.amount;

    match args.side {
        TradeSide::Buy => {
            // USDC in: the signer really pays.
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.owner_usdc.to_account_info(),
                        to: ctx.accounts.vault_usdc.to_account_info(),
                        authority: ctx.accounts.owner.to_account_info(),
                    },
                ),
                args.amount,
            )?;

            // Shares out: only the vault PDA can authorise this.
            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.owner_shares.to_account_info(),
                        authority: ctx.accounts.vault.to_account_info(),
                    },
                    &[signer_seeds],
                ),
                quantity,
            )?;

            let vault = &mut ctx.accounts.vault;
            vault.usdc_reserve = vault
                .usdc_reserve
                .checked_add(args.amount)
                .ok_or(FomoError::MathOverflow)?;
            vault.shares_outstanding = vault
                .shares_outstanding
                .checked_add(quantity)
                .ok_or(FomoError::MathOverflow)?;

            let holding = &mut ctx.accounts.holding;
            if holding.owner == Pubkey::default() {
                holding.owner = ctx.accounts.owner.key();
                holding.asset = asset_key;
                holding.quantity = 0;
                holding.avg_price = 0;
                holding.bump = ctx.bumps.holding;
            }
            let next_qty = holding
                .quantity
                .checked_add(quantity)
                .ok_or(FomoError::MathOverflow)?;
            // Volume-weighted average entry, in USDC per share.
            holding.avg_price = ((holding.quantity as u128)
                .checked_mul(holding.avg_price as u128)
                .ok_or(FomoError::MathOverflow)?
                .checked_add(
                    (args.amount as u128)
                        .checked_mul(pow10(decimals)?)
                        .ok_or(FomoError::MathOverflow)?,
                )
                .ok_or(FomoError::MathOverflow)?
                / next_qty as u128) as u64;
            holding.quantity = next_qty;
        }
        TradeSide::Sell => {
            // Pay out against the shares actually burned, not the requested
            // notional. `quantity` is floored, so paying `args.amount` would
            // hand the seller up to one base unit more than their shares are
            // worth on every sell — a slow drain on the reserve.
            let payout = quote_payout(quantity, effective_price, decimals)?;
            require!(payout > 0, FomoError::InvalidAmount);

            let holding = &mut ctx.accounts.holding;
            require!(
                holding.owner == ctx.accounts.owner.key() && holding.quantity >= quantity,
                FomoError::InsufficientHolding
            );

            // Shares in: burned, so supply stays honest.
            token::burn(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Burn {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.owner_shares.to_account_info(),
                        authority: ctx.accounts.owner.to_account_info(),
                    },
                ),
                quantity,
            )?;

            // USDC out, paid from the reserve by the vault PDA.
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault_usdc.to_account_info(),
                        to: ctx.accounts.owner_usdc.to_account_info(),
                        authority: ctx.accounts.vault.to_account_info(),
                    },
                    &[signer_seeds],
                ),
                payout,
            )?;

            holding.quantity = holding
                .quantity
                .checked_sub(quantity)
                .ok_or(FomoError::MathOverflow)?;

            let vault = &mut ctx.accounts.vault;
            vault.usdc_reserve = vault
                .usdc_reserve
                .checked_sub(payout)
                .ok_or(FomoError::InsufficientVaultReserve)?;
            vault.shares_outstanding = vault
                .shares_outstanding
                .checked_sub(quantity)
                .ok_or(FomoError::MathOverflow)?;

            // The receipt records what actually settled.
            settled_amount = payout;
        }
    }

    let now = Clock::get()?.unix_timestamp;
    let receipt = &mut ctx.accounts.receipt;
    receipt.owner = ctx.accounts.owner.key();
    receipt.asset = asset_key;
    receipt.side = args.side;
    receipt.amount_usdc = settled_amount;
    receipt.quantity = quantity;
    receipt.price = effective_price;
    receipt.timestamp = now;
    receipt.source_receipt = args.source_receipt;
    receipt.bump = ctx.bumps.receipt;

    ctx.accounts.asset.trade_count = ctx
        .accounts
        .asset
        .trade_count
        .checked_add(1)
        .ok_or(FomoError::MathOverflow)?;

    emit!(TradeReceiptEvent {
        owner: receipt.owner,
        asset: receipt.asset,
        side: receipt.side,
        amount_usdc: receipt.amount_usdc,
        quantity: receipt.quantity,
        price: receipt.price,
        source_receipt: receipt.source_receipt,
    });
    Ok(())
}

/// Buyers pay a little over oracle, sellers receive a little under. This is the
/// only revenue the vault takes, and it is what keeps the reserve solvent when
/// flows are one-sided.
fn apply_spread(price: u64, spread_bps: u16, side: TradeSide) -> Result<u64> {
    let price = price as u128;
    let bps = spread_bps as u128;
    let adjusted = match side {
        TradeSide::Buy => price
            .checked_mul(10_000 + bps)
            .ok_or(FomoError::MathOverflow)?,
        TradeSide::Sell => price
            .checked_mul(10_000 - bps)
            .ok_or(FomoError::MathOverflow)?,
    } / 10_000;
    require!(adjusted > 0, FomoError::InvalidPrice);
    u64::try_from(adjusted).map_err(|_| error!(FomoError::MathOverflow))
}

/// shares = usdc_notional * 10^decimals / price_per_share
///
/// Both `amount` and `price` carry 6 decimals, so the 10^decimals factor is
/// what lands `quantity` in the share mint's own base units.
fn quote_quantity(amount: u64, price: u64, decimals: u8) -> Result<u64> {
    require!(price > 0, FomoError::InvalidPrice);
    let numerator = (amount as u128)
        .checked_mul(pow10(decimals)?)
        .ok_or(FomoError::MathOverflow)?;
    u64::try_from(numerator / price as u128).map_err(|_| error!(FomoError::MathOverflow))
}

/// The inverse of `quote_quantity`: usdc = shares * price / 10^decimals.
/// Floors, so the vault never pays out more than the shares are worth.
fn quote_payout(quantity: u64, price: u64, decimals: u8) -> Result<u64> {
    let numerator = (quantity as u128)
        .checked_mul(price as u128)
        .ok_or(FomoError::MathOverflow)?;
    u64::try_from(numerator / pow10(decimals)?).map_err(|_| error!(FomoError::MathOverflow))
}

fn pow10(exp: u8) -> Result<u128> {
    let mut acc: u128 = 1;
    for _ in 0..exp {
        acc = acc.checked_mul(10).ok_or(FomoError::MathOverflow)?;
    }
    Ok(acc)
}
