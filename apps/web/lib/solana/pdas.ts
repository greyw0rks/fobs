import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { programId } from "./config";

/**
 * PDA derivation, mirroring the seeds in `programs/fomo/src/`.
 *
 * The seed byte widths are load-bearing and are the single easiest thing to get
 * wrong here. Rust seeds these with `to_le_bytes()` on the field's real type, so
 * `Protocol.asset_count` (a `u16`) is a **two**-byte seed while
 * `Asset.trade_count` (a `u64`) is eight. Encoding both as eight bytes produces
 * a valid, plausible-looking address that the program disagrees with, and the
 * resulting `ConstraintSeeds` error prints two base58 strings with no hint as to
 * which is which:
 *
 *     Left  = the address the client passed
 *     Right = what the program derived
 *
 * Keep these in step with `state/protocol.rs` and `state/asset.rs`.
 */

const SEED = {
  protocol: Buffer.from("protocol"),
  asset: Buffer.from("asset"),
  vault: Buffer.from("vault"),
  mint: Buffer.from("mint"),
  mockOracle: Buffer.from("mock_oracle"),
  receipt: Buffer.from("receipt"),
  holding: Buffer.from("holding")
} as const;

export function u16le(n: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(n);
  return buffer;
}

export function u64le(n: bigint | number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(n));
  return buffer;
}

function derive(seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId())[0];
}

/** `Protocol.asset_count` is a `u16` → a two-byte seed. */
export function assetPda(onchainId: number): PublicKey {
  return derive([SEED.asset, u16le(onchainId)]);
}

export function protocolPda(): PublicKey {
  return derive([SEED.protocol]);
}

export function vaultPda(asset: PublicKey): PublicKey {
  return derive([SEED.vault, asset.toBuffer()]);
}

export function shareMintPda(asset: PublicKey): PublicKey {
  return derive([SEED.mint, asset.toBuffer()]);
}

export function mockOraclePda(asset: PublicKey): PublicKey {
  return derive([SEED.mockOracle, asset.toBuffer()]);
}

/** `Asset.trade_count` is a `u64` → genuinely eight bytes. */
export function receiptPda(asset: PublicKey, tradeCount: bigint | number): PublicKey {
  return derive([SEED.receipt, asset.toBuffer(), u64le(tradeCount)]);
}

/** One per (owner, asset). Created by the program on first trade. */
export function holdingPda(owner: PublicKey, asset: PublicKey): PublicKey {
  return derive([SEED.holding, owner.toBuffer(), asset.toBuffer()]);
}

/** The vault's USDC token account — an ATA owned by the vault PDA, not a PDA. */
export function vaultUsdcAddress(vault: PublicKey, usdcMint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(usdcMint, vault, true);
}
