/**
 * The pre-IPO dislocation surface: what a PreStocks token costs against the
 * issuer's own mark, after the cost of getting in and back out again.
 *
 * This is the product wedge. `prestocks.ts` gives a `premium` and it is the most
 * informative number in this market, but printed raw it is actively misleading —
 * because the transfer fee means a round trip is not free, and on 2026-09-20 the
 * fee doubled. A 1.2% discount that costs 2% to trade is not an opportunity; it
 * is a loss with a nice sign on it.
 *
 * So every row carries both numbers, and the surface is sorted by the one that
 * survives the costs.
 *
 * ## The mark is not a bid
 *
 * `markPrice` is the issuer's own reference for SPV-backed exposure. Nothing
 * redeems against it. There is no path that converts a token into the mark, so a
 * discount is **not** an arbitrage and this module must never present it as one:
 * it is a dislocation, and closing it requires someone else to agree the mark is
 * right and buy. The gap can widen for as long as the market disagrees with the
 * SPV, and the issuer has no obligation to make it converge.
 *
 * That is why the output is a *ranking of dislocations*, not a list of trades.
 *
 * ## Long-only, so only a discount is actionable
 *
 * A token trading above the mark is informative — it says holders are being paid
 * above the issuer's own reference — but this app cannot act on it. There is no
 * borrow, no short, and no redemption. So `actionableLong` requires a discount,
 * and a premium is carried with `actionableLong: false` rather than dressed up
 * as a signal.
 *
 * ## Costs move on a schedule, so the ranking does too
 *
 * The fee is read from each mint's epoch schedule, never hardcoded. On
 * 2026-09-20 it was 50bps rising to 100bps at epoch 1039 — which takes the round
 * trip from 1% to 2% and moves names across the actionable line without a single
 * price changing. `feeBps` and `epoch` are on every row because a ranking whose
 * inputs have moved is a ranking that needs re-reading.
 *
 * ## Thin books make dislocations noisy
 *
 * Anthropic's pools held roughly $333k with quiet-day volume near $100k. Against
 * a book that shallow, part of any premium is a liquidity artifact rather than a
 * view on the company. This module cannot measure depth on its own — `quoteSwap`
 * is what surfaces price impact — so the limitation is stated here rather than
 * papered over with a confidence score nothing supports.
 */

import { fetchPreStocks } from "./prestocks";
import type { PreStockToken } from "./prestocks";
import {
  feeBpsForEpoch,
  issuerCanActUnilaterally,
  readEpoch,
  readMintPolicy,
  reconcileMultiplier
} from "./token2022";
import type { MintPolicy, ReconciledMultiplier } from "./token2022";
import { roundTripCost } from "./quote";

/**
 * Which side of the mark a token is on.
 *
 * `discount` means the market is paying *less* than the issuer's mark. `par` is
 * carried rather than folded into either side, because a token exactly at the
 * mark is not a weak signal in one direction — it is the absence of a signal.
 */
export type Dislocation = "discount" | "par" | "premium";

export type PremiumRow = {
  symbol: string;
  name: string;
  mint: string;
  /** USD per *scaled* unit, from the issuer. */
  markPrice: number;
  /** USD per *scaled* unit, from the market. */
  tokenPrice: number;
  /** `tokenPrice / markPrice − 1`. Positive is above the mark. */
  grossPremium: number;
  /** What the market has to move to reach the mark, unsigned, as a fraction. */
  grossDislocation: number;
  /** The mint's transfer fee for `epoch`, in basis points. */
  feeBps: number;
  /** Enter and exit, as a fraction. `2 × feeBps`. */
  roundTripCost: number;
  /**
   * `grossDislocation − roundTripCost`. Positive means the gap is bigger than
   * the cost of capturing it.
   */
  netDislocation: number;
  direction: Dislocation;
  /**
   * A discount that survives its own round trip.
   *
   * Requires `direction === "discount"`: a premium is a real fact about this
   * market, but a long-only app cannot trade it, and calling it actionable would
   * be selling a capability this app does not have.
   */
  actionableLong: boolean;
  /**
   * The multiplier that turns a raw on-chain balance into scaled units, and
   * where it came from. Carried on every row because it is the difference
   * between a correct position value and one that is wrong by 5×.
   */
  multiplier: ReconciledMultiplier;
  /**
   * The issuer can seize, freeze or halt this token. Stated as a fact about the
   * mint, not a risk score — see `token2022.ts`.
   */
  issuerControls: boolean;
};

/** A row we could not build, and why. One failure never hides the others. */
export type PremiumError = { symbol: string; reason: string };

export type PremiumSurface = {
  /** The epoch `feeBps` was resolved against. */
  epoch: number;
  /** Every row, most actionable first. */
  rows: PremiumRow[];
  errors: PremiumError[];
};

function classify(grossPremium: number, epsilon: number): Dislocation {
  if (grossPremium > epsilon) return "premium";
  if (grossPremium < -epsilon) return "discount";
  return "par";
}

/**
 * A premium below this is the absence of a signal, not a small one.
 *
 * Floating point alone puts the last bits of `tokenPrice / markPrice - 1` in the
 * 1e-16 range, and these prices arrive as JSON numbers. A basis point is far
 * below anything this market can resolve, so it is a generous and safe floor.
 */
const PAR_EPSILON = 1e-4;

/**
 * Build one row, or throw with a reason worth reading.
 *
 * The multiplier is reconciled before anything is priced. It is not decoration:
 * the API's prices are per scaled unit, and a raw balance priced against them is
 * wrong by the multiplier — 5× on SpaceX. Reading it here means a caller cannot
 * accidentally build the surface without that step.
 */
function buildRow(
  token: PreStockToken,
  policy: MintPolicy,
  epoch: number,
  nowSeconds: number
): PremiumRow {
  const feeBps = feeBpsForEpoch(policy, epoch);
  const grossPremium = token.premium;
  const grossDislocation = Math.abs(grossPremium);
  const roundTrip = roundTripCost(feeBps);
  const netDislocation = grossDislocation - roundTrip;
  const direction = classify(grossPremium, PAR_EPSILON);

  const multiplier = reconcileMultiplier(policy, token.supply, nowSeconds);

  return {
    symbol: token.symbol,
    name: token.name,
    mint: token.mint,
    markPrice: token.markPrice,
    tokenPrice: token.tokenPrice,
    grossPremium,
    grossDislocation,
    feeBps,
    roundTripCost: roundTrip,
    netDislocation,
    direction,
    actionableLong: direction === "discount" && netDislocation > 0,
    multiplier,
    issuerControls: issuerCanActUnilaterally(policy)
  };
}

/**
 * The whole surface, actionable first, then by what survives the round trip.
 *
 * Rows a long-only trader could act on come first; within each group, the
 * biggest surviving edge leads. Sorting purely by gross premium would put the
 * largest headline number on top whether or not it can be captured, which is the
 * failure this module exists to prevent — and sorting purely by net edge still
 * lets an untradeable premium outrank a live discount.
 *
 * Throws only when `fetchPreStocks` throws, i.e. when there is no list at all. A
 * single bad mint becomes a row in `errors`, because an outage on one token is
 * not an outage on the market.
 */
export async function premiumSurface(nowSeconds?: number): Promise<PremiumSurface> {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  const [tokens, epoch] = await Promise.all([fetchPreStocks(), readEpoch()]);

  const rows: PremiumRow[] = [];
  const errors: PremiumError[] = [];

  // Sequential rather than concurrent: these are eight `getAccountInfo` calls
  // against one public endpoint, and the RPC rate-limits per method. Eight
  // parallel reads is how this gets a 429 and reports seven tokens missing.
  for (const token of tokens) {
    try {
      const policy = await readMintPolicy(token.mint);
      rows.push(buildRow(token, policy, epoch, now));
    } catch (error) {
      errors.push({
        symbol: token.symbol,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Actionable rows first, then by how much edge survives the round trip.
  //
  // Not by `netDislocation` alone. A premium can carry a larger absolute gap
  // than any discount — NEURALINK's was +31% against SPACEX's −23% on
  // 2026-09-20 — so sorting on magnitude puts a row this app cannot act on at
  // the top of a list headed "1 of 8 actionable". The biggest number in this
  // market is usually not the tradeable one, and the ranking should not imply
  // otherwise. Ties break on symbol so the order is stable across calls: two
  // rows that are genuinely equal should not swap places between renders and
  // make a quiet market look active.
  rows.sort(
    (a, b) =>
      Number(b.actionableLong) - Number(a.actionableLong) ||
      b.netDislocation - a.netDislocation ||
      a.symbol.localeCompare(b.symbol)
  );

  return { epoch, rows, errors };
}

/**
 * The rows a long-only trader could actually act on.
 *
 * Derived rather than stored, so `rows` stays the whole truth and nothing
 * downstream has to remember which subset it was handed.
 */
export function actionable(rows: PremiumRow[]): PremiumRow[] {
  return rows.filter((row) => row.actionableLong);
}

/**
 * The one-line summary this market deserves.
 *
 * Deliberately reports the count that is *not* actionable alongside the one that
 * is. A surface that only ever announces opportunities is advertising; the
 * number that makes it a measurement is how much of the market is noise.
 */
export function summarize(surface: PremiumSurface): string {
  const total = surface.rows.length;
  const live = actionable(surface.rows).length;
  const parts = [`${live} of ${total} actionable at epoch ${surface.epoch}`];

  // The fee is a per-mint property, so it is not assumed uniform. Today every
  // PreStocks mint shares one schedule and this prints a single number; if one
  // ever diverges, a range is the honest thing to print rather than whichever
  // row happened to sort first.
  const costs = [...new Set(surface.rows.map((row) => row.roundTripCost))].sort((a, b) => a - b);
  if (costs.length === 1) {
    parts.push(`round trip ${(costs[0] * 100).toFixed(2)}%`);
  } else if (costs.length > 1) {
    parts.push(
      `round trip ${(costs[0] * 100).toFixed(2)}–${(costs[costs.length - 1] * 100).toFixed(2)}%`
    );
  }

  if (surface.errors.length > 0) parts.push(`${surface.errors.length} unpriced`);
  return parts.join(" · ");
}
