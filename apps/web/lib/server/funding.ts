import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  mintTo
} from "@solana/spl-token";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { connection, usdcMint } from "@/lib/solana/config";
import { isProduction } from "./devnet-only";

/**
 * Funding a newly created wallet.
 *
 * This is the only code in the web app that holds the admin key, and it is here
 * because onboarding a real user has to give them something to trade with. It
 * is deliberately a separate module from custody: custody holds *user* keys and
 * signs trades, this holds the *mint authority* and only ever creates test
 * tokens. Keeping them apart means a bug in the trade path cannot reach the
 * mint.
 *
 * The admin key is read from `FOBS_ADMIN_KEYPAIR` (a path), falling back to the
 * same `ANCHOR_WALLET` the scripts use, so one devnet account drives everything.
 * If it is not configured, onboarding still creates the wallet — it just does
 * not fund it, and says so. An unfunded wallet is a legible state; a silently
 * skipped funding step is not.
 */

/** Enough for many transactions: each trade is a fee plus ~2M lamports of ATA rent. */
export const SOL_PER_USER = 0.5;
/** Buying power for the demo. Selling needs no USDC, so this only has to cover buys. */
export const USDC_PER_USER = 25_000n * 10n ** 6n;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Devnet's public RPC rate-limits bursts, so every call that can be retried is. */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${String(lastError)}`);
}

export function adminKeypair(): Keypair | null {
  const path =
    process.env.FOBS_ADMIN_KEYPAIR ??
    process.env.ANCHOR_WALLET ??
    `${homedir()}/.config/solana/id.json`;
  if (!existsSync(path)) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  } catch {
    return null;
  }
}

export function fundingConfigured(): boolean {
  return adminKeypair() !== null;
}

export type FundingResult = {
  sol: number;
  usdc: number;
  /** Empty when everything the wallet needed was already there. */
  skipped: string[];
};

/**
 * Bring a wallet up to `SOL_PER_USER` and `USDC_PER_USER`.
 *
 * Create-if-missing throughout, so running it twice converges rather than
 * compounding — which is what makes it safe to call from both sign-in and the
 * first trade without tracking whether it has already run.
 */
export async function fundWallet(address: PublicKey): Promise<FundingResult> {
  // Same gate as test-user signing. Funding wallets means holding the mint
  // authority, and that must not happen on a production deployment.
  if (isProduction()) {
    throw new Error("Refusing to fund a wallet on a production deployment.");
  }

  const admin = adminKeypair();
  if (!admin) {
    return { sol: 0, usdc: 0, skipped: ["no admin keypair configured"] };
  }

  const conn: Connection = connection();
  const skipped: string[] = [];
  let sol = 0;
  let usdc = 0;

  // --- SOL ----------------------------------------------------------------
  const balance = await withRetry("SOL balance", () => conn.getBalance(address));
  const target = Math.round(SOL_PER_USER * LAMPORTS_PER_SOL);
  // Half the target, not all of it: a wallet that has spent some SOL trading is
  // still funded, and topping it up every call would drain the admin instead.
  if (balance < target / 2) {
    const topUp = target - balance;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: address,
        lamports: topUp
      })
    );
    const signature = await withRetry("SOL transfer", () =>
      conn.sendTransaction(tx, [admin], { skipPreflight: true })
    );
    await withRetry("SOL confirmation", () =>
      conn.confirmTransaction(signature, "confirmed")
    );
    sol = topUp / LAMPORTS_PER_SOL;
    // Devnet 429s on bursts; a fresh wallet needs several transactions at once.
    await sleep(250);
  }

  // --- USDC ---------------------------------------------------------------
  const mint = usdcMint();
  const ata = getAssociatedTokenAddressSync(mint, address);
  const ataInfo = await withRetry("USDC account", () => conn.getAccountInfo(ata));
  if (!ataInfo) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(admin.publicKey, ata, address, mint)
    );
    const signature = await withRetry("USDC account creation", () =>
      conn.sendTransaction(tx, [admin], { skipPreflight: true })
    );
    await withRetry("USDC account confirmation", () =>
      conn.confirmTransaction(signature, "confirmed")
    );
    await sleep(250);
  }

  const held = await withRetry("USDC balance", () =>
    conn
      .getTokenAccountBalance(ata)
      .then((r) => BigInt(r.value.amount))
      .catch(() => 0n)
  );
  if (held < USDC_PER_USER) {
    const delta = USDC_PER_USER - held;
    await withRetry("USDC mint", () => mintTo(conn, admin, mint, ata, admin, delta));
    usdc = Number(delta) / 1e6;
  }

  if (sol === 0) skipped.push("SOL already sufficient");
  if (usdc === 0) skipped.push("USDC already sufficient");
  return { sol, usdc, skipped };
}
