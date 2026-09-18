//! Price resolution. The trading instruction never branches on where a price
//! came from: it calls `read_price` and gets a normalized USDC-per-share value.
//!
//! ```text
//!                   read_price()
//!                        |
//!               +--------+--------+
//!               v                 v
//!             Pyth            MockOracle
//!               |                 |
//!               +--------+--------+
//!                        v
//!                normalized 6dp price
//!                        v
//!                     trade()
//! ```

use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::Pubkey as SolanaPubkey;

use crate::errors::FomoError;
use crate::state::{Asset, MockOracle, PriceSource};

/// Pyth's on-chain receiver, owner of every `PriceUpdateV2` account.
/// Same address on mainnet and devnet (verified 2026-09-18).
///
/// Written as bytes rather than `pubkey!("rec5EKMGg…")`: that macro expands to
/// `solana_program::…` paths resolved against *this* crate, which does not
/// depend on `solana-program` directly, so it fails to compile.
pub const PYTH_RECEIVER: SolanaPubkey = SolanaPubkey::new_from_array([
    12, 183, 250, 187, 82, 247, 166, 72, 187, 91, 49, 125, 154, 1, 139, 144, 87, 203, 2, 71, 116,
    250, 254, 1, 230, 196, 223, 152, 204, 56, 88, 129,
]);

/// Refuse to trade on stale data: a stale price silently becomes a free option.
/// MockOracle is exempt by construction — it is chosen precisely because the
/// real feed is unavailable, and it is admin-gated.
pub const MAX_PRICE_AGE_SECS: i64 = 90;

/// Every price this program handles is USD per share with 6 decimals, matching
/// USDC. A $178.24 share is `178_240_000`.
pub const PRICE_DECIMALS: u32 = 6;

/// Solana `AccountInfo` layout of a Pyth `PriceUpdateV2`, confirmed by decoding
/// the live SOL/USD account `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`.
///
/// ```text
///   0 ..  8   Anchor discriminator
///   8 .. 40   write_authority  (Pubkey)
///  40 .. 41   verification_level (u8)
///  41 .. 73   feed_id          ([u8; 32])
///  73 .. 81   price            (i64)
///  81 .. 89   conf             (u64)
///  89 .. 93   exponent         (i32)
///  93 ..101   publish_time     (i64)
/// ```
///
/// We parse by offset rather than pulling in `pyth-sdk-solana` so the layout
/// stays auditable here; swapping in the SDK's `PriceUpdateV2::try_deserialize`
/// later is a drop-in change behind this module.
mod layout {
    pub const FEED_ID_OFFSET: usize = 41;
    pub const FEED_ID_LEN: usize = 32;
    pub const PRICE_OFFSET: usize = 73;
    pub const CONF_OFFSET: usize = 81;
    pub const EXPONENT_OFFSET: usize = 89;
    pub const PUBLISH_TIME_OFFSET: usize = 93;
    pub const MIN_LEN: usize = PUBLISH_TIME_OFFSET + 8;
}

/// Resolve the asset's price in USDC per share at 6 decimals.
///
/// Takes the `Account` wrapper rather than the bare `Asset` struct because the
/// mock path needs the asset's on-chain address to bind the oracle to it.
pub fn read_price(asset: &Account<Asset>, price_account: &UncheckedAccount) -> Result<u64> {
    match asset.price_source {
        PriceSource::Pyth => read_pyth_price(asset, price_account),
        PriceSource::Mock => read_mock_price(asset, price_account),
    }
}

fn read_mock_price(asset: &Account<Asset>, price_account: &UncheckedAccount) -> Result<u64> {
    // The owner check has to be explicit here: deserializing from raw bytes
    // skips the validation that `Account::try_from` performs, so without this a
    // look-alike account owned by another program would be accepted.
    require_keys_eq!(*price_account.owner, crate::ID, FomoError::WrongPriceAccount);

    // Deserialize straight from the borrowed bytes. Routing through
    // `Account::<MockOracle>::try_from(&info)` instead would force a temporary
    // `AccountInfo` to outlive the account's own lifetime parameter, which the
    // borrow checker rejects. `try_deserialize` also checks the discriminator.
    let data = price_account.try_borrow_data()?;
    let mut slice: &[u8] = &data;
    let oracle = MockOracle::try_deserialize(&mut slice)?;

    require_keys_eq!(oracle.asset, asset.key(), FomoError::WrongPriceAccount);
    require!(oracle.price > 0, FomoError::InvalidPrice);
    Ok(oracle.price)
}

fn read_pyth_price(asset: &Account<Asset>, price_account: &UncheckedAccount) -> Result<u64> {
    require_keys_eq!(
        *price_account.owner,
        PYTH_RECEIVER,
        FomoError::WrongPriceAccount
    );

    let data = price_account.try_borrow_data()?;
    let data: &[u8] = &data;
    require!(data.len() >= layout::MIN_LEN, FomoError::InvalidPrice);

    let feed_id = &data[layout::FEED_ID_OFFSET..layout::FEED_ID_OFFSET + layout::FEED_ID_LEN];
    require!(
        feed_id == asset.price_feed.as_ref(),
        FomoError::WrongPriceAccount
    );

    let price = i64::from_le_bytes(read_array::<8>(data, layout::PRICE_OFFSET)?);
    let exponent = i32::from_le_bytes(read_array::<4>(data, layout::EXPONENT_OFFSET)?);
    let publish_time = i64::from_le_bytes(read_array::<8>(data, layout::PUBLISH_TIME_OFFSET)?);

    require!(price > 0, FomoError::InvalidPrice);

    let now = Clock::get()?.unix_timestamp;
    let age = now.saturating_sub(publish_time);
    require!(age <= MAX_PRICE_AGE_SECS, FomoError::StalePrice);

    normalize_to_price_decimals(price, exponent)
}

/// Convert a Pyth mantissa/exponent pair into a fixed 6-decimal value.
/// Pyth equity feeds typically publish with exponent -8.
fn normalize_to_price_decimals(price: i64, exponent: i32) -> Result<u64> {
    let shift = exponent
        .checked_add(PRICE_DECIMALS as i32)
        .ok_or(FomoError::InvalidPrice)?;

    let scaled: i128 = if shift >= 0 {
        (price as i128)
            .checked_mul(pow10(shift as u32)?)
            .ok_or(FomoError::InvalidPrice)?
    } else {
        (price as i128) / pow10((-shift) as u32)?
    };

    require!(scaled > 0, FomoError::InvalidPrice);
    u64::try_from(scaled).map_err(|_| error!(FomoError::InvalidPrice))
}

fn pow10(exp: u32) -> Result<i128> {
    let mut acc: i128 = 1;
    for _ in 0..exp {
        acc = acc.checked_mul(10).ok_or(FomoError::InvalidPrice)?;
    }
    Ok(acc)
}

fn read_array<const N: usize>(data: &[u8], offset: usize) -> Result<[u8; N]> {
    data.get(offset..offset + N)
        .and_then(|slice| slice.try_into().ok())
        .ok_or_else(|| error!(FomoError::InvalidPrice))
}
