"use client";

import { VersionedTransaction, type PublicKey } from "@solana/web3.js";
import { ApiError, api } from "@/lib/api";
import type { FeedTrade } from "@/lib/types";

/**
 * Place a trade signed by the browser wallet rather than by the server.
 *
 * FOBS is a bridge, so a trade is a Jupiter swap of a real mainnet token. The
 * split is still the point: the server *builds* the swap (so the owner comes
 * from the session, never from here), the wallet *signs* it (so the key never
 * leaves the browser), and the server *sends* it (so the client cannot lie about
 * what landed). Nothing in FOBS holds a key, and the server signs nothing.
 *
 * The economics the server records come from the prepared quote, which is why
 * this function derives `quantity` and `price` from it rather than inventing
 * them: the same fee-adjusted numbers the user saw are the ones that get stored.
 */

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** The part of a wallet adapter this needs — `useWallet()`'s shape, narrowed. */
export type Signer = {
  publicKey: PublicKey;
  signTransaction?: <T extends VersionedTransaction>(transaction: T) => Promise<T>;
};

export class WalletSigningUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletSigningUnavailableError";
  }
}

const USDC_BASE = 1_000_000; // USDC is 6 decimals.

export async function signAndSubmitTrade(
  signer: Signer,
  body: {
    symbol: string;
    side: "buy" | "sell";
    amountUsdc: number;
    /** Token base units to sell. Required for a sell, ignored for a buy. */
    amountTokens?: string | null;
    sourceTradeId?: string | null;
  }
): Promise<FeedTrade> {
  if (!signer.signTransaction) {
    throw new WalletSigningUnavailableError(
      "This wallet does not support signing a transaction without sending it. " +
        "Try Phantom, Solflare or Backpack."
    );
  }

  // Two attempts, because Jupiter pins the swap to a recent blockhash that can
  // expire between preparing and submitting. The browser signs over a specific
  // block, so unlike a server-signed path this cannot be retried server-side — a
  // fresh prepare is the only fix, and one silent retry covers a slow approval.
  for (let attempt = 0; ; attempt++) {
    const prepared = await api.prepareTrade(body);

    const transaction = VersionedTransaction.deserialize(decode(prepared.transaction));
    const signed = await signer.signTransaction(transaction);

    // Derive the recorded economics from the same quote the user saw. USDC is 6
    // decimals; the token's decimals come back with the quote.
    const { quote } = prepared;
    const tokenScale = 10 ** quote.tokenDecimals;
    const isBuy = prepared.side === "buy";
    const quantity = isBuy
      ? Number(quote.outAmount) / tokenScale // tokens received
      : Number(quote.inAmount) / tokenScale; // tokens sold
    const amountUsdc = isBuy
      ? prepared.amountUsdc // USDC spent
      : Number(quote.outAmount) / USDC_BASE; // USDC received
    const price = quantity > 0 ? amountUsdc / quantity : 0;

    try {
      const result = await api.submitTrade({
        transaction: encode(signed.serialize()),
        symbol: prepared.symbol,
        side: prepared.side,
        amountUsdc,
        quantity,
        price,
        sourceTradeId: body.sourceTradeId ?? null
      });
      return result.trade;
    } catch (error) {
      const stale = error instanceof ApiError && error.code === "blockhash_stale";
      if (stale && attempt === 0) continue;
      throw error;
    }
  }
}
