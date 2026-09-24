import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Every address the app needs to talk to the program, in one place.
 *
 * The program id and USDC mint come from the environment rather than being
 * hard-coded, because they differ per cluster and a wrong-but-well-formed id
 * fails in a way that reads like a program bug (see "Sharp edges" in
 * HANDOFF.md). `scripts/devnet-bootstrap.ts` prints the values to set.
 */

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(
      `${name} is not set. Run \`pnpm devnet:bootstrap\` and copy the two values it prints into .env.local.`
    );
  }
  return value;
}

export function programId(): PublicKey {
  return new PublicKey(
    required("NEXT_PUBLIC_FOMO_PROGRAM_ID", "Fomo9DbW4wbTRSz9eU82Tp1HH27LQJPUYZzcZoSKonxL")
  );
}

/**
 * USDC — the quote currency for every swap the bridge routes.
 *
 * On mainnet this is the canonical Circle mint, not something this app issues:
 * FOBS is a medium into markets that already exist, so it holds no mint
 * authority and burns nothing. The env override exists only so a fork can point
 * at a test mint; the default is the real one.
 */
export function usdcMint(): PublicKey {
  return new PublicKey(
    required("NEXT_PUBLIC_USDC_MINT", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
  );
}

export function rpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
}

/**
 * The endpoint the *browser* points its wallet adapter at.
 *
 * Separate from `rpcUrl()` because Next only inlines `NEXT_PUBLIC_*` into the
 * client bundle — `SOLANA_RPC_URL` is a server variable and reaching for it in a
 * client component yields `undefined` at runtime rather than an error, which is
 * the kind of bug that looks like the wallet is broken.
 *
 * The browser never sends a trade through this connection: a signed transaction
 * goes to `POST /api/trades/submit`, so the server does the sending and the
 * service can be configured with a private endpoint where one exists. This
 * endpoint is what the adapter uses to answer "is this wallet connected to the
 * right cluster" and to read balances for display.
 */
export function browserRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    process.env.NEXT_PUBLIC_RPC_URL ??
    "https://api.mainnet-beta.solana.com"
  );
}

let cached: Connection | null = null;
let cachedUrl: string | null = null;

export function connection(): Connection {
  const url = rpcUrl();
  // Rebuild rather than reuse when the URL changes, so a test that points at a
  // local validator does not silently keep talking to devnet.
  if (!cached || cachedUrl !== url) {
    cached = new Connection(url, "confirmed");
    cachedUrl = url;
  }
  return cached;
}

/** USDC and every synthetic share in this program use 6 decimals. */
export const DECIMALS = 6;

export const BASE = 10n ** BigInt(DECIMALS);

/** `u64` base units to a JS number, for display and for the DB's Decimal. */
export function fromBaseUnits(value: bigint | { toString(): string }): number {
  return Number(value.toString()) / Number(BASE);
}

/** A USD amount to `u64` base units, rejecting the rounding that silently loses money. */
export function toBaseUnits(usd: number): bigint {
  const scaled = usd * Number(BASE);
  if (!Number.isFinite(scaled) || Math.abs(scaled) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${usd} is out of range for a u64 amount`);
  }
  return BigInt(Math.round(scaled));
}
