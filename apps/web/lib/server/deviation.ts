/**
 * The deviation guard: refuse a route when the venue's own price disagrees with
 * the reference it claims to track.
 *
 * A routed equity token is a claim on a real share. The venue that sells it is a
 * pool, and a pool can be wrong — thin, stale, manipulated, or simply the last
 * place a seller looked. The Pyth reference is the anchor: if USDC → NVDAx
 * implies $180 when NVDA is $222, the pool is not offering a bargain, it is
 * mispriced, and a router that fills there has handed its user a bad trade with
 * a good-looking number.
 *
 * That is the whole guard, and it is only worth having if it is honest about the
 * two ways it can be wrong:
 *
 *   - **Refusing good trades.** The reference is Friday's close for 65 hours
 *     every weekend, and the venue tracks it to within a third of a percent
 *     anyway (measured 2026-09-20: NVDAx implied $221.78 against a $222.51
 *     reference, −33bps). A guard that read staleness as untrustworthiness would
 *     block every weekend route against perfectly good data. So `freshness` is
 *     consulted, and a market closure is not a failure — it is a labelled
 *     reference. See `pyth-reference.ts`.
 *
 *   - **Passing bad trades.** A reference that has stopped *while the market is
 *     open* is a broken oracle, not a closed market, and nothing should be routed
 *     against it. Nor against a reference that could not be read at all.
 *
 * ## Why an unreadable reference fails closed
 *
 * When Pyth cannot be reached there is no reference and therefore no check. The
 * two options are to route unchecked or to refuse, and this module refuses —
 * deliberately, and unlike the staleness case above. The difference is what the
 * failure tells you about the *market*: a shut market is a fact about the world
 * that the reference already accounts for, whereas an unreachable oracle is a
 * missing check. A guard that silently degrades to "allow" is not a guard, it is
 * a comment. The cost is that Pyth being down stops routing, which is the
 * correct trade to make and is why `verdict: "unchecked"` is reported separately
 * from `"dislocated"` — a caller that wants to accept that risk can see exactly
 * what it is accepting.
 */

import { referencePrice, type ReferencePrice } from "./pyth-reference";

/**
 * How far a venue may sit from the reference before a route is refused.
 *
 * A policy number, not a measured one — but calibrated against the one
 * measurement there is. On 2026-09-20 a live NVDAx route tracked its
 * closed-market reference to −33bps, so 3% leaves roughly nine times the
 * observed tracking error for genuine overnight gaps and thin-pool slippage,
 * while still catching the failure this exists to catch: a pool priced against
 * something other than the share.
 */
export const DEFAULT_TOLERANCE_BPS = 300;

export type DeviationVerdict =
  | "ok"
  | "dislocated"
  /** No reference could be read, so nothing was checked. */
  | "unchecked";

export type DeviationCheck = {
  symbol: string;
  /** USD per underlying unit, implied by the venue's quote. */
  impliedPrice: number;
  reference: ReferencePrice | null;
  /**
   * Signed basis points: positive means the venue is charging *more* than the
   * reference. Null when there is no reference to compare against.
   */
  deviationBps: number | null;
  toleranceBps: number;
  verdict: DeviationVerdict;
  /** Whether the route should proceed. False for both "dislocated" and "unchecked". */
  allowed: boolean;
  /**
   * True when the reference is the last close rather than a live price. The
   * comparison is still valid; the wording on any surface built from it is not
   * allowed to call it "now".
   */
  referenceIsLastClose: boolean;
  reason: string;
};

/**
 * USD per unit of the thing being bought, from the quote that would buy it.
 *
 * Kept here rather than in `quote.ts` because it is the guard's input, and
 * because the units are the part that goes wrong: `usd` is whole dollars and
 * `units` is whole tokens, so any caller holding base units has to divide by
 * decimals first. On NVDAx, whose mint has 8, that is the difference between
 * $221.78 and $22 billion.
 */
export function impliedPrice(usd: number, units: number): number {
  if (!(units > 0)) throw new Error(`implied price needs a positive unit count, got ${units}`);
  return usd / units;
}

/**
 * Compare an implied price against the Pyth reference for the underlying.
 *
 * `symbol` is the underlying's US ticker (`NVDA`), not the routed token's
 * (`NVDAx`) — the reference feed is for the share, and the routed token is only
 * a wrapper that claims to track it.
 */
export async function checkDeviation(params: {
  symbol: string;
  impliedPrice: number;
  toleranceBps?: number;
  rpcUrl?: string;
  nowSeconds?: number;
}): Promise<DeviationCheck> {
  const toleranceBps = params.toleranceBps ?? DEFAULT_TOLERANCE_BPS;
  const base = { symbol: params.symbol.toUpperCase(), impliedPrice: params.impliedPrice, toleranceBps };

  let reference: ReferencePrice;
  try {
    reference = await referencePrice(params.symbol, {
      rpcUrl: params.rpcUrl,
      nowSeconds: params.nowSeconds
    });
  } catch (error) {
    return {
      ...base,
      reference: null,
      deviationBps: null,
      verdict: "unchecked",
      allowed: false,
      referenceIsLastClose: false,
      reason:
        `no reference to check against, so the route is refused rather than passed unchecked — ` +
        `${error instanceof Error ? error.message : String(error)}`
    };
  }

  // A feed that stopped while the market was trading is a broken oracle. There
  // is a reference object here, but there is no reference *price*.
  if (reference.freshness.state === "stale") {
    return {
      ...base,
      reference,
      deviationBps: null,
      verdict: "unchecked",
      allowed: false,
      referenceIsLastClose: false,
      reason: `reference is stale and the market's own schedule does not explain it: ${reference.freshness.reason}`
    };
  }

  const deviationBps =
    ((params.impliedPrice - reference.price) / reference.price) * 10_000;
  const dislocated = Math.abs(deviationBps) > toleranceBps;
  const referenceIsLastClose = reference.freshness.state === "closed";

  const magnitude = `${Math.abs(deviationBps).toFixed(0)}bps`;
  const side = deviationBps > 0 ? "above" : "below";

  return {
    ...base,
    reference,
    deviationBps,
    verdict: dislocated ? "dislocated" : "ok",
    allowed: !dislocated,
    referenceIsLastClose,
    reason: dislocated
      ? `venue implies $${params.impliedPrice.toFixed(2)} against a reference of ` +
        `$${reference.price.toFixed(2)} — ${magnitude} ${side}, outside the ${toleranceBps}bps ` +
        `tolerance${referenceIsLastClose ? " (reference is the last close)" : ""}`
      : `venue implies $${params.impliedPrice.toFixed(2)} against a reference of ` +
        `$${reference.price.toFixed(2)} — ${magnitude} ${side}, within tolerance` +
        `${referenceIsLastClose ? " (reference is the last close, not a live price)" : ""}`
  };
}
