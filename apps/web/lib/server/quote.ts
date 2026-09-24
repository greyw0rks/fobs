/**
 * Jupiter routing, plus the transfer fee Jupiter only sometimes deducts.
 *
 * Every PreStocks token charges a Token-2022 transfer fee, and `outAmount` from
 * Jupiter's quote endpoint is not consistently net of it. That was measured, not
 * assumed — simulate the swap, read the destination account's actual delta, and
 * compare (`pnpm calibrate:venues`):
 *
 *   SPACEX     Meteora DLMM  quoted 164,594,745  received 164,594,745  1.000000
 *   NEURALINK  Manifest      quoted 225,174,983  received 224,049,108  0.995000
 *   OPENAI     Manifest      quoted  59,782,447  received  59,483,534  0.995000
 *
 * Vault-side deltas confirm the fee is charged in all three cases at exactly
 * 0.5000%. So the fee is universal and Jupiter's *accounting* for it is
 * per-venue — Meteora nets it, Manifest does not, and Jupiter documents neither.
 *
 * The consequence is not cosmetic. A user swapping into NEURALINK receives
 * 0.5% less than the number on screen, and `otherAmountThreshold` derives from
 * the same gross figure, so tight slippage does not protect them: the on-chain
 * check passes against the pool's gross output while the destination gets less.
 *
 * ## How this module handles that
 *
 * Two things, in order of importance:
 *
 * 1. It never returns a raw `outAmount`. `SwapQuote.outAmount` is what the
 *    destination receives, and `quotedOutAmount` is kept alongside it so the
 *    difference is inspectable rather than inferred.
 * 2. It fails safe on venues it has not calibrated. `UNKNOWN_VENUE` is `gross`
 *    in both directions, so an unrecognised venue over-subtracts. Understating
 *    what a user will receive is a worse product and a better failure than
 *    overstating it.
 *
 * ## What a sell actually does
 *
 * Leaving the pool, the fee is withheld from the token being sold, so the pool
 * receives less than the user sent. Measured exactly on SPACEX: the seller was
 * debited 399,999,673 base units and the pool credited 397,999,674, so 1,999,999
 * was withheld — 0.5000%, against a scheduled 50bps.
 *
 * That the fee is charged does not mean the quote ignores it. Whether the quoted
 * USDC already reflects the reduced pool input is the per-venue question, and it
 * has the same answer in both directions — see the table below.
 *
 * ## What this deliberately does not do
 *
 * It does not do arithmetic on `priceImpactPct`. Jupiter returns that field as a
 * string and its scale (fraction or percent) is not documented in a way that
 * survives checking, so it is carried through verbatim as `priceImpactPctRaw`
 * and the calibration script prints it next to a measured impact instead of this
 * module guessing. A number we cannot interpret is not a number to compute with.
 */

import type { MintPolicy } from "./token2022";
import { feeBpsForEpoch, readEpoch } from "./token2022";

const QUOTE_URL = process.env.JUPITER_QUOTE_URL ?? "https://lite-api.jup.ag/swap/v1/quote";

/** A quote is a fetch, not a trade: fail fast and let the caller retry. */
const TIMEOUT_MS = 10_000;

/** Which way the fee-bearing token is moving. */
export type Direction = "buy" | "sell";

/**
 * Whether the venue's quoted output already has the transfer fee deducted.
 *
 * `nets` means Jupiter's `outAmount` is what arrives; `gross` means the fee is
 * still to come out of it.
 */
export type NettingBehavior = "nets" | "gross";

/**
 * Calibrated per venue and per direction, by simulation — see
 * `scripts/calibrate-venues.ts`.
 *
 * ## Why this table is now per venue rather than per direction
 *
 * Both directions were measured on 2026-09-20. On a single-leg route the reading
 * is unambiguous, and the two venues that produced one in *both* directions
 * agreed with themselves:
 *
 *   NEURALINK  sell  Meteora DLMM  quoted 0.0967  received 0.0967   nets
 *   POLYMARKET sell  Manifest      quoted 0.3646  received 0.3628   gross
 *
 * Netting is a property of how a venue accounts for the token, so it does not
 * depend on which way the token is moving. The table is therefore symmetric
 * wherever both directions were measured.
 *
 * `Hadron`'s sell entry is the exception: it was measured on a buy and not on a
 * sell, so it keeps the conservative default rather than being inferred from its
 * own buy row. An inference in the safe direction is a guess; the default is at
 * least an honest one.
 *
 * ## This table is smaller than it looks, and that is deliberate
 *
 * Jupiter's routing is not stable. Across two calibration runs on the same day
 * the same tokens routed through `GoonFi V2` and `Quantum`, then through
 * `HumidiFi`, `Deriverse` and `Hadron` — the venue labels behind a given pair
 * change as liquidity shifts. So this table cannot be the mechanism that keeps
 * quotes honest; `UNKNOWN_VENUE` is. Entries are added only when a venue was
 * measured on a *single-leg* route, where the reading is unambiguous, and a
 * venue seen only inside a split route is left out because there the
 * measurement is confounded with the other leg.
 *
 * The practical consequence: on an unmeasured venue this module under-promises.
 * That is the intended failure direction, and it is why the default matters more
 * than the table.
 */
export const VENUE_NETTING: Record<string, Record<Direction, NettingBehavior>> = {
  "Meteora DLMM": { buy: "nets", sell: "nets" },
  Manifest: { buy: "gross", sell: "gross" },
  Hadron: { buy: "nets", sell: "gross" }
};

/**
 * Applied to any venue not in the table above, and to every venue on a route
 * that splits across more than one. `gross` errs toward showing a user less than
 * they will get.
 */
const UNKNOWN_VENUE: Record<Direction, NettingBehavior> = { buy: "gross", sell: "gross" };

export class SwapQuoteError extends Error {
  constructor(reason: string) {
    super(`No route: ${reason}`);
    this.name = "SwapQuoteError";
  }
}

export type SwapQuote = {
  inputMint: string;
  outputMint: string;
  /** Input base units. Unaffected by the fee — this is what leaves the wallet. */
  inAmount: bigint;
  /** Jupiter's `outAmount`, verbatim. Not what the user receives. */
  quotedOutAmount: bigint;
  /** What the destination account actually receives. Use this one. */
  outAmount: bigint;
  /** Withheld by the mint's transfer fee, in output base units. */
  feeAmount: bigint;
  /** The fee that produced `feeAmount`, in basis points, for this epoch. */
  transferFeeBps: number;
  /** How `outAmount` was derived. `gross` means we subtracted the fee. */
  netting: NettingBehavior;
  /** Venue labels from Jupiter's route, in order. */
  venues: string[];
  /** Venues absent from `VENUE_NETTING` — the quote is conservative, not wrong. */
  unverifiedVenues: string[];
  /**
   * Jupiter's own field, string and all. See the module note: the scale is
   * unverified, so nothing downstream should compute with it.
   */
  priceImpactPctRaw: string | null;
  /**
   * Jupiter's entire quote payload, verbatim.
   *
   * `/swap` will not accept a reconstructed quote — it wants the exact object
   * `/quote` returned, routePlan and all, because the transaction it builds is
   * pinned to that specific route. So we carry it rather than rebuild it, and
   * `buildSwapTransaction` hands it straight back.
   */
  jupiterQuote: Record<string, unknown>;
};

/**
 * Which netting behavior applies to a route.
 *
 * A split route is treated as `gross` if *any* leg is, because a leg we cannot
 * account for is a leg that might not be accounted for — and the safe direction
 * is the same either way.
 */
export function nettingFor(
  venues: string[],
  direction: Direction
): { behavior: NettingBehavior; unverified: string[] } {
  const unverified: string[] = [];
  let behavior: NettingBehavior = "nets";

  for (const venue of venues) {
    const known = VENUE_NETTING[venue];
    if (!known) unverified.push(venue);
    const leg = known ? known[direction] : UNKNOWN_VENUE[direction];
    if (leg === "gross") behavior = "gross";
  }

  // A route with no labels at all tells us nothing, so it gets the safe answer.
  if (venues.length === 0) behavior = UNKNOWN_VENUE[direction];
  return { behavior, unverified };
}

/**
 * Apply the fee to a quoted amount. Pure, so it can be tested without a network.
 *
 * Truncates rather than rounds. The difference is a base unit, and rounding up
 * would promise a user an amount the chain might not deliver.
 */
export function applyNetting(
  quotedOutAmount: bigint,
  transferFeeBps: number,
  behavior: NettingBehavior
): { outAmount: bigint; feeAmount: bigint } {
  if (behavior === "nets" || transferFeeBps <= 0) {
    return { outAmount: quotedOutAmount, feeAmount: 0n };
  }
  const feeAmount = (quotedOutAmount * BigInt(transferFeeBps)) / 10_000n;
  return { outAmount: quotedOutAmount - feeAmount, feeAmount };
}

type RawQuote = {
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;
  priceImpactPct?: string;
  routePlan?: { swapInfo?: { label?: string } }[];
};

/**
 * A swap quote whose `outAmount` is what the destination will actually receive.
 *
 * `inputMint` and `outputMint` decide the direction, which decides which of the
 * two mints' policy the caller should pass: buying a fee-bearing token means the
 * *output* policy applies, selling it means the *input* one does. Passing the
 * wrong policy silently applies the wrong fee, so the caller is expected to
 * resolve it rather than this function guessing from mint addresses.
 *
 * Throws rather than returning a fallback. A quote with an invented number is
 * worse than no quote: it is a price a user can act on that nothing produced.
 */
export async function quoteSwap(params: {
  inputMint: string;
  outputMint: string;
  /** Input amount in base units. */
  amount: bigint;
  /** The fee-bearing mint's policy, or null when neither mint charges one. */
  policy: MintPolicy | null;
  /** Passed to Jupiter. Defaults to 1%, which is the on-chain guard's own bound. */
  slippageBps?: number;
  /** Skips a round trip to `getEpochInfo` when the caller already has one. */
  epoch?: number;
}): Promise<SwapQuote> {
  const { inputMint, outputMint, amount, policy } = params;
  const direction: Direction = policy?.mint === outputMint ? "buy" : "sell";

  // Only the fee-bearing side matters. A token that charges nothing contributes
  // nothing, so a null policy means the whole computation is a no-op — which is
  // the common case for the listed-equity synthetics.
  const transferFeeBps = policy
    ? feeBpsForEpoch(policy, params.epoch ?? (await readEpoch()))
    : 0;

  let payload: RawQuote;
  try {
    const url =
      `${QUOTE_URL}?inputMint=${encodeURIComponent(inputMint)}` +
      `&outputMint=${encodeURIComponent(outputMint)}` +
      `&amount=${amount.toString()}` +
      `&slippageBps=${params.slippageBps ?? 100}`;
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      // A cached route is a stale price wearing a fresh timestamp.
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) throw new SwapQuoteError(`jupiter returned ${response.status}`);
    payload = (await response.json()) as RawQuote;
  } catch (error) {
    if (error instanceof SwapQuoteError) throw error;
    throw new SwapQuoteError(error instanceof Error ? error.message : String(error));
  }

  const quotedRaw = payload.outAmount;
  if (typeof quotedRaw !== "string") {
    throw new SwapQuoteError("response carried no outAmount");
  }
  const quotedOutAmount = BigInt(quotedRaw);
  if (quotedOutAmount <= 0n) throw new SwapQuoteError("route returned zero output");

  const venues = (payload.routePlan ?? [])
    .map((leg) => leg.swapInfo?.label)
    .filter((label): label is string => typeof label === "string" && label.length > 0);

  const { behavior, unverified } = nettingFor(venues, direction);
  const { outAmount, feeAmount } = applyNetting(quotedOutAmount, transferFeeBps, behavior);

  return {
    inputMint,
    outputMint,
    inAmount: amount,
    quotedOutAmount,
    outAmount,
    feeAmount,
    transferFeeBps,
    netting: behavior,
    venues,
    unverifiedVenues: unverified,
    priceImpactPctRaw: typeof payload.priceImpactPct === "string" ? payload.priceImpactPct : null,
    jupiterQuote: payload as unknown as Record<string, unknown>
  };
}

const SWAP_URL = process.env.JUPITER_SWAP_URL ?? QUOTE_URL.replace(/\/quote$/, "/swap");

/** A swap builds a transaction, which is heavier than a quote — give it longer. */
const SWAP_TIMEOUT_MS = 15_000;

export class SwapBuildError extends Error {
  constructor(reason: string) {
    super(`Could not build swap: ${reason}`);
    this.name = "SwapBuildError";
  }
}

export type BuiltSwap = {
  /**
   * A base64 **VersionedTransaction**, unsigned, fee-payer set to the user's
   * wallet. The browser signs it and the server sends it — no key ever leaves
   * the browser, and FOBS signs nothing.
   */
  swapTransaction: string;
  /** The block height past which the transaction is dead. Null if Jupiter omits it. */
  lastValidBlockHeight: number | null;
};

/**
 * Turn a quote into a signable Jupiter swap for a specific wallet.
 *
 * The wallet address is the only thing this adds to the quote: the transaction
 * moves tokens between *that* wallet's accounts and the pool, so a swap built
 * for one wallet cannot be signed by another. `/prepare` passes the session
 * wallet, never a client-supplied one, for the same reason the synthetic path
 * did — the owner is the server's fact, not the browser's claim.
 *
 * Modeled on `scripts/calibrate-venues.ts`, which is the only place that hit
 * `/swap` before the bridge existed.
 */
export async function buildSwapTransaction(params: {
  quote: SwapQuote;
  userPublicKey: string;
  /** Wrap/unwrap SOL when it is a leg. Default true, which is what a user expects. */
  wrapAndUnwrapSol?: boolean;
}): Promise<BuiltSwap> {
  let payload: { swapTransaction?: string; lastValidBlockHeight?: number };
  try {
    const response = await fetch(SWAP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(SWAP_TIMEOUT_MS),
      body: JSON.stringify({
        quoteResponse: params.quote.jupiterQuote,
        userPublicKey: params.userPublicKey,
        wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
        // The token accounts a swap touches may not exist yet; let Jupiter add
        // the create instructions rather than failing on a missing ATA.
        dynamicComputeUnitLimit: true
      })
    });
    if (!response.ok) throw new SwapBuildError(`jupiter /swap returned ${response.status}`);
    payload = (await response.json()) as typeof payload;
  } catch (error) {
    if (error instanceof SwapBuildError) throw error;
    throw new SwapBuildError(error instanceof Error ? error.message : String(error));
  }

  if (typeof payload.swapTransaction !== "string" || payload.swapTransaction.length === 0) {
    throw new SwapBuildError("response carried no swapTransaction");
  }
  return {
    swapTransaction: payload.swapTransaction,
    lastValidBlockHeight:
      typeof payload.lastValidBlockHeight === "number" ? payload.lastValidBlockHeight : null
  };
}

/**
 * The cost of entering and leaving a position, as a fraction.
 *
 * This is the number the premium surface needs, and the reason a raw premium is
 * misleading: at a 1% fee, a round trip costs 2%, which exceeds the premium on
 * five of the eight names.
 *
 * Takes the fee rather than a policy, because the caller has usually already
 * resolved it for the current epoch and resolving it twice invites the two
 * answers to disagree across an epoch boundary.
 */
export function roundTripCost(feeBps: number): number {
  return (feeBps / 10_000) * 2;
}
