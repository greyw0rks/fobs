/**
 * What a wallet holds in PreStocks tokens, priced correctly.
 *
 * This is the module where `token2022.ts` stops being theory. A raw on-chain
 * balance is **not** the number of units the API prices: SpaceX carries a ×5
 * `scaledUiAmountConfig`, OpenAI ×1.4861347, and pricing a raw balance against a
 * per-scaled-unit price understates the position by exactly that multiplier.
 * Nothing throws, nothing looks wrong, and the number is wrong by 5×. So every
 * balance here goes through `toScaledAmount`, and both the raw and scaled
 * figures are returned so a surface can show the conversion rather than assert
 * it.
 *
 * ## Two values, because a position is not a price
 *
 * `valueUsd` is what the tokens are worth at the market price. `exitValueUsd` is
 * what the holder would actually receive selling them, after the mint's transfer
 * fee. The gap is not a rounding detail — it was 1% of the position on
 * 2026-09-20 and doubles at epoch 1039. A portfolio that shows only `valueUsd`
 * is quoting a price nobody can transact at.
 *
 * ## Reading a devnet wallet against mainnet usually returns nothing
 *
 * These tokens are mainnet and this app's wallets are devnet, so in practice
 * this returns an empty list — and that is a correct answer, not a failure. It
 * is worth being explicit about because the empty state is the one that will
 * actually be on screen, and "we found no PreStocks positions" must never be
 * rendered as "we could not check".
 */

import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { describeError } from "./describe-error";
import { fetchPreStocks } from "./prestocks";
import type { PreStockToken } from "./prestocks";
import {
  feeBpsForEpoch,
  issuerCanActUnilaterally,
  prestocksRpcUrl,
  readEpoch,
  readMintPolicy,
  reconcileMultiplier,
  toScaledAmount
} from "./token2022";
import { TOKEN_2022_PROGRAM } from "./token2022";
import type { MintPolicy, ReconciledMultiplier } from "./token2022";

const TIMEOUT_MS = 15_000;

export type PreStockPosition = {
  symbol: string;
  name: string;
  mint: string;
  /** Base units, exactly as the chain reports them. Not a unit count. */
  rawAmount: bigint;
  /** The mint's decimals, needed to read `rawAmount` as tokens at all. */
  decimals: number;
  /**
   * Whole tokens, *before* the multiplier — `rawAmount / 10^decimals`. This is
   * the number a naive portfolio shows, and on SpaceX it is a fifth of the
   * truth.
   */
  rawTokens: number;
  /** Whole tokens after the multiplier. What every price is quoted per. */
  scaledAmount: number;
  /** How `scaledAmount` was derived, and whether the two sources agreed. */
  multiplier: ReconciledMultiplier;
  /** USD per scaled unit, from the issuer's endpoint. */
  tokenPrice: number;
  /** `scaledAmount × tokenPrice`. */
  valueUsd: number;
  /** The mint's transfer fee for the current epoch. */
  feeBps: number;
  /** What selling the whole position would actually return. */
  exitValueUsd: number;
  /** The mint's fee, as a fraction, for display next to the two values. */
  exitCostFraction: number;
  /** The issuer can seize, freeze or halt this token. */
  issuerControls: boolean;
};

/** One mint we could not price, and why. Never merged into the total. */
export type PositionError = { symbol: string; reason: string };

export type PreStocksPositions = {
  wallet: string;
  /** Positions with a non-zero balance, largest first. */
  positions: PreStockPosition[];
  /** Sum of `valueUsd`. Excludes nothing — `errors` is separate. */
  totalValueUsd: number;
  /** Sum of `exitValueUsd`, the number that survives a sale. */
  totalExitValueUsd: number;
  /** Symbols where measured and configured multipliers disagreed. */
  multiplierDisagreements: string[];
  errors: PositionError[];
  /**
   * False when the address is a program-derived account rather than a wallet.
   *
   * Worth carrying, because the two produce the same empty result for different
   * reasons and only one of them is a fact about a person's holdings. A PDA —
   * a pool authority, say — holds its tokens in a vault that is not its
   * associated account, so an ATA scan is guaranteed to miss them. Reporting
   * that as "this wallet holds nothing" would be a claim we have not checked.
   */
  onCurve: boolean;
  /** True when every mint was read and the address holds none of them. */
  empty: boolean;
};

export class PositionsUnavailableError extends Error {
  constructor(reason: string) {
    super(`No PreStocks positions: ${reason}`);
    this.name = "PositionsUnavailableError";
  }
}

type TokenAccountValue = {
  data?: {
    parsed?: {
      info?: {
        mint?: string;
        tokenAmount?: { amount?: string; decimals?: number };
      };
    };
  };
} | null;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let body: unknown;
  try {
    const response = await fetch(prestocksRpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
    if (!response.ok) throw new PositionsUnavailableError(`${method} returned ${response.status}`);
    body = await response.json();
  } catch (error) {
    if (error instanceof PositionsUnavailableError) throw error;
    throw new PositionsUnavailableError(
      `${method}: ${describeError(error)}`
    );
  }

  const parsed = body as { result?: T; error?: { message?: string } };
  if (parsed.error) {
    throw new PositionsUnavailableError(`${method}: ${parsed.error.message ?? "rpc error"}`);
  }
  if (parsed.result === undefined) throw new PositionsUnavailableError(`${method}: no result`);
  return parsed.result;
}

function positionFor(
  token: PreStockToken,
  policy: MintPolicy,
  raw: bigint,
  decimals: number,
  epoch: number,
  nowSeconds: number
): PreStockPosition {
  const multiplier = reconcileMultiplier(policy, token.supply, nowSeconds);
  const scaledAmount = toScaledAmount(raw, policy, multiplier.multiplier);
  const valueUsd = scaledAmount * token.tokenPrice;

  const feeBps = feeBpsForEpoch(policy, epoch);
  // The fee is withheld from the tokens being sold, so it reduces what arrives
  // rather than being charged on top. Applying it to the position's value is
  // exactly the same arithmetic from the holder's side.
  const exitCostFraction = feeBps / 10_000;

  return {
    symbol: token.symbol,
    name: token.name,
    mint: token.mint,
    rawAmount: raw,
    decimals,
    rawTokens: Number(raw) / 10 ** decimals,
    scaledAmount,
    multiplier,
    tokenPrice: token.tokenPrice,
    valueUsd,
    feeBps,
    exitValueUsd: valueUsd * (1 - exitCostFraction),
    exitCostFraction,
    issuerControls: issuerCanActUnilaterally(policy)
  };
}

/**
 * Every PreStocks position a wallet holds, priced through the multiplier.
 *
 * Throws when the wallet address is not a valid public key, or when the issuer's
 * list is unreachable — both are conditions the caller cannot paper over, and a
 * portfolio that quietly renders empty for either is a portfolio that lies about
 * what someone owns.
 *
 * A single mint that fails to read becomes an entry in `errors` and is left out
 * of the totals, so the totals are always a sum of things actually verified.
 */
export async function prestocksPositions(
  walletAddress: string,
  nowSeconds?: number
): Promise<PreStocksPositions> {
  let owner: PublicKey;
  try {
    owner = new PublicKey(walletAddress);
  } catch {
    throw new PositionsUnavailableError(`${walletAddress} is not a valid address`);
  }

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  const [tokens, epoch] = await Promise.all([fetchPreStocks(), readEpoch()]);

  // Deriving all eight associated accounts lets one `getMultipleAccounts` cover
  // the wallet instead of eight reads — and eight parallel reads against a
  // public endpoint is how the last module earned a 429.
  //
  // `allowOwnerOffCurve` is true, and that is load-bearing. A plain wallet is
  // on-curve, but these mints are also held by pool authorities, which are PDAs.
  // Deriving with the strict setting throws `TokenOwnerOffCurveError` for such an
  // address — an error with no message, so it surfaces as a silent exit rather
  // than a complaint. Accepting any address and reporting what it holds is the
  // honest behaviour: refusing to read a valid address is a worse failure than
  // reading one that turns out to be empty.
  let addresses: string[];
  try {
    addresses = tokens.map((token) =>
      getAssociatedTokenAddressSync(
        new PublicKey(token.mint),
        owner,
        true,
        new PublicKey(TOKEN_2022_PROGRAM)
      ).toBase58()
    );
  } catch (error) {
    throw new PositionsUnavailableError(
      `could not derive token accounts for ${owner.toBase58()}: ${describeError(error)}`
    );
  }

  const accounts = await rpc<{ value?: TokenAccountValue[] }>("getMultipleAccounts", [
    addresses,
    { encoding: "jsonParsed" }
  ]);
  if (accounts.value?.length !== addresses.length) {
    throw new PositionsUnavailableError(
      `expected ${addresses.length} accounts, received ${accounts.value?.length ?? 0}`
    );
  }

  const positions: PreStockPosition[] = [];
  const errors: PositionError[] = [];
  const multiplierDisagreements: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const account = accounts.value?.[index];
    if (!account) continue;

    const amount = account.data?.parsed?.info?.tokenAmount?.amount;
    if (typeof amount !== "string" || BigInt(amount) === 0n) continue;

    try {
      const policy = await readMintPolicy(token.mint);
      const decimals = account.data?.parsed?.info?.tokenAmount?.decimals ?? policy.decimals;
      const position = positionFor(token, policy, BigInt(amount), decimals, epoch, now);

      if (position.multiplier.disagreement) multiplierDisagreements.push(token.symbol);
      positions.push(position);
    } catch (error) {
      errors.push({
        symbol: token.symbol,
        reason: describeError(error)
      });
    }
  }

  positions.sort((a, b) => b.valueUsd - a.valueUsd || a.symbol.localeCompare(b.symbol));

  const totalValueUsd = positions.reduce((sum, position) => sum + position.valueUsd, 0);
  const totalExitValueUsd = positions.reduce((sum, position) => sum + position.exitValueUsd, 0);

  return {
    wallet: owner.toBase58(),
    positions,
    totalValueUsd,
    totalExitValueUsd,
    multiplierDisagreements,
    errors,
    onCurve: PublicKey.isOnCurve(owner.toBytes()),
    empty: positions.length === 0 && errors.length === 0
  };
}

/**
 * The multiplier as it should be shown next to a balance.
 *
 * A wallet that holds nothing is not a wallet with a ×1 multiplier, and printing
 * `×1` for "we did not look" is the same class of error as printing `$0.00` for
 * "we could not price it".
 */
export function describeMultiplier(multiplier: ReconciledMultiplier): string {
  return `×${multiplier.multiplier.toFixed(7)} (${multiplier.source})`;
}
