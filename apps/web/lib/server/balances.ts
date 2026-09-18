import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connection, usdcMint } from "@/lib/solana/config";
import type { WalletBalances } from "@/lib/types";

/**
 * What a wallet actually holds, read live from devnet.
 *
 * Deliberately not cached in Postgres. A balance is the one number where a stale
 * value is worse than a slow one — it is what the trade panel refuses a trade
 * against, so a cached balance would let someone attempt a trade the program
 * will reject. Everything else in this app is a cache of the chain; this is a
 * direct read, and it is cheap enough (two RPC calls) to be one.
 */

export type { WalletBalances } from "@/lib/types";

export async function getWalletBalances(
  walletAddress: string | null
): Promise<WalletBalances | null> {
  if (!walletAddress) return null;

  let owner: PublicKey;
  try {
    owner = new PublicKey(walletAddress);
  } catch {
    return null;
  }

  const conn = connection();
  const usdcAccount = getAssociatedTokenAddressSync(usdcMint(), owner);

  const [lamports, token] = await Promise.all([
    conn.getBalance(owner).catch(() => null),
    conn.getTokenAccountBalance(usdcAccount).catch(() => null)
  ]);

  return {
    sol: lamports === null ? 0 : lamports / 1_000_000_000,
    usdc: token ? Number(token.value.uiAmountString ?? 0) : 0,
    usdcAccountExists: token !== null
  };
}
