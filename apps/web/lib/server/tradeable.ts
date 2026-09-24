/**
 * One asset universe, across three markets FOBS does not issue.
 *
 * The whole product is "one place": a user should not have to know that NVDA is
 * a Backed xStock, that SPACEX is a PreStocks Token-2022 mint, or that Ondo runs
 * its own rail. This module is the seam that makes them look like one list of
 * things you can buy — each resolved to a real mainnet mint, its decimals, and
 * (where it exists) the two facts a trade needs to be honest: the transfer-fee
 * policy, and a Pyth reference to check the venue price against.
 *
 * FOBS mints none of these and holds no authority over any of them. It is a
 * medium into markets that already exist, so this module only ever *reads*.
 *
 * ## Why a key, not a bare symbol
 *
 * Two issuers list the same ticker: Backed's NVDA and Ondo's NVDA are different
 * mints. A bare "NVDA" cannot name one of them, so the universe is keyed:
 *
 *   NVDA          Backed's xStock — the deep, Pyth-clean default for a listed name
 *   NVDA-ondo     Ondo's tokenized NVDA — a different mint, a different (shallow) pool
 *   SPACEX        a PreStocks pre-IPO mint — no second issuer, so the bare symbol is the key
 *
 * The listed default is Backed on purpose: its pools are deep and track Pyth
 * within tens of bps, where Ondo's Solana equity pools are thin enough that the
 * deviation guard rejects them (NVDAon implied $617 against a $224 reference).
 * Ondo stays in the universe because the user asked for it, but it is never the
 * silent answer to a bare ticker.
 */

import { fetchPreStock } from "./prestocks";
import { readMintPolicy, type MintPolicy } from "./token2022";
import { routedEquityFor, SUPPORTED, type Issuer } from "./routed-equities";

export type TradeableKind = "xstock" | "ondo" | "prestock";

export type Tradeable = {
  /** Unique across the universe. What the trade routes accept. */
  key: string;
  /** Display ticker. Not unique on its own — see the module note. */
  symbol: string;
  name: string;
  kind: TradeableKind;
  /** The real mainnet mint. FOBS issues none of these. */
  mint: string;
  decimals: number;
  /**
   * The fee-bearing mint policy, when the token charges a Token-2022 transfer
   * fee (every PreStocks mint does). `null` for tokens that do not, so the quote
   * layer treats the fee as a no-op.
   */
  policy: MintPolicy | null;
  /**
   * The underlying ticker a Pyth reference exists for, or `null` when none does.
   *
   * Listed equities (xStocks, Ondo) have one, so a trade can be refused when the
   * venue price drifts from it. Pre-IPO names have no public reference price at
   * all — the mark is the issuer's own, not a market — so there is nothing to
   * check against and the surface says so rather than inventing a guard.
   */
  referenceSymbol: string | null;
};

export class TradeableError extends Error {
  constructor(reason: string) {
    super(`No tradeable: ${reason}`);
    this.name = "TradeableError";
  }
}

/** The eight PreStocks pre-IPO names the bridge opens. */
export const PRESTOCK_SYMBOLS = [
  "SPACEX",
  "OPENAI",
  "ANTHROPIC",
  "ANDURIL",
  "KALSHI",
  "NEURALINK",
  "POLYMARKET",
  "FIGUREAI"
] as const;

const ONDO_SUFFIX = "-ondo";

function isPrestock(key: string): boolean {
  return (PRESTOCK_SYMBOLS as readonly string[]).includes(key.toUpperCase());
}

async function fromIssuer(issuer: Issuer, symbol: string, key: string): Promise<Tradeable> {
  const equity = await routedEquityFor(issuer, symbol);
  return {
    key,
    symbol: equity.symbol,
    name: equity.name,
    kind: issuer === "Ondo" ? "ondo" : "xstock",
    mint: equity.mint,
    decimals: equity.decimals,
    // xStocks/Ondo are not the fee-bearing case the quote layer models; the fee
    // math is a PreStocks property. Left null so nothing is subtracted twice.
    policy: null,
    referenceSymbol: equity.symbol
  };
}

async function fromPrestock(symbol: string): Promise<Tradeable> {
  const token = await fetchPreStock(symbol);
  if (!token) throw new TradeableError(`PreStocks does not list ${symbol}`);
  // The policy is read from the chain, not the API — decimals and the epoch fee
  // schedule both live on the mint, and both are needed to quote a swap honestly.
  const policy = await readMintPolicy(token.mint);
  return {
    key: symbol.toUpperCase(),
    symbol: token.symbol,
    name: token.name,
    kind: "prestock",
    mint: token.mint,
    decimals: policy.decimals,
    policy,
    referenceSymbol: null
  };
}

/**
 * Resolve one key to a tradeable, validated against its issuer.
 *
 * Throws rather than falling back. A registry that guesses hands the user a
 * mint that is not the thing they asked for, and prices it as though it were.
 */
export async function tradeableFor(key: string): Promise<Tradeable> {
  const trimmed = key.trim();
  if (!trimmed) throw new TradeableError("empty key");

  if (trimmed.toLowerCase().endsWith(ONDO_SUFFIX)) {
    const symbol = trimmed.slice(0, -ONDO_SUFFIX.length).toUpperCase();
    return fromIssuer("Ondo", symbol, `${symbol}${ONDO_SUFFIX}`);
  }
  if (isPrestock(trimmed)) {
    return fromPrestock(trimmed.toUpperCase());
  }
  // A bare listed ticker means Backed — the deep, reference-clean default.
  const symbol = trimmed.toUpperCase();
  if ((SUPPORTED as readonly string[]).includes(symbol)) {
    return fromIssuer("Backed", symbol, symbol);
  }
  throw new TradeableError(`unknown key ${key}`);
}
