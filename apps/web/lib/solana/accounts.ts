import type * as anchor from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";

/**
 * `program.account`, typed.
 *
 * The IDL is imported from JSON, so TypeScript widens every account name to
 * `string` and Anchor's `AccountNamespace<Idl>` cannot recover the per-account
 * keys. `program.account.tradeReceipt.fetch(...)` is a correct runtime lookup
 * that does not typecheck.
 *
 * Declaring the three accounts this app reads restores the types at the call
 * sites instead of casting at each one — and, more usefully, it means a Rust
 * field rename shows up here as a compile error rather than as `undefined` at
 * runtime, which is how this class of bug normally presents.
 *
 * Field names are camelCase because `convertIdlToCamelCase` runs inside the
 * `Program` constructor. See HANDOFF sharp edge 12.
 */

/** Anchor's generated account client for one account type. */
type AccountClient<T> = {
  fetch(address: PublicKey): Promise<T>;
};

export type AssetAccount = {
  id: number;
  symbol: number[];
  mint: PublicKey;
  vault: PublicKey;
  priceFeed: PublicKey;
  priceSource: Record<string, unknown>;
  decimals: number;
  tradeCount: anchor.BN;
  bump: number;
};

export type MockOracleAccount = {
  asset: PublicKey;
  price: anchor.BN;
  updatedAt: anchor.BN;
  bump: number;
};

export type TradeReceiptAccount = {
  owner: PublicKey;
  asset: PublicKey;
  /** A Rust enum, so it arrives as `{ buy: {} }` or `{ sell: {} }`. */
  side: Record<string, unknown>;
  amountUsdc: anchor.BN;
  quantity: anchor.BN;
  price: anchor.BN;
  timestamp: anchor.BN;
  sourceReceipt: PublicKey | null;
  bump: number;
};

export type AssetVaultAccount = {
  asset: PublicKey;
  usdcReserve: anchor.BN;
  sharesOutstanding: anchor.BN;
  bump: number;
};

export type HoldingAccount = {
  owner: PublicKey;
  asset: PublicKey;
  quantity: anchor.BN;
  /** Volume-weighted average entry, USDC per share (6dp), maintained on chain. */
  avgPrice: anchor.BN;
  bump: number;
};

export type FomoAccounts = {
  asset: AccountClient<AssetAccount>;
  mockOracle: AccountClient<MockOracleAccount>;
  tradeReceipt: AccountClient<TradeReceiptAccount>;
  assetVault: AccountClient<AssetVaultAccount>;
  holding: AccountClient<HoldingAccount>;
};
