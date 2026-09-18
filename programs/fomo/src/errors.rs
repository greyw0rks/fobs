use anchor_lang::prelude::*;

#[error_code]
pub enum FomoError {
    #[msg("Only the admin may perform this action")]
    Unauthorized,
    #[msg("Price is stale")]
    StalePrice,
    #[msg("Price account is not the one this asset is configured with")]
    WrongPriceAccount,
    #[msg("Token account does not hold the expected mint")]
    WrongMint,
    #[msg("Oracle reported a non-positive price")]
    InvalidPrice,
    #[msg("Vault reserve is insufficient")]
    InsufficientVaultReserve,
    #[msg("Holding balance is insufficient")]
    InsufficientHolding,
    #[msg("Invalid trade amount")]
    InvalidAmount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Asset symbol is not valid UTF-8 or is empty")]
    InvalidSymbol,
}
