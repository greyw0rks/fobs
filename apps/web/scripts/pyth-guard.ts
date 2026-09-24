/**
 * The Pyth deviation guard, run against live mainnet routes.
 *
 * Run: `pnpm pyth:guard`
 *
 * For every supported equity, from every issuer that lists it, this quotes USDC
 * → token on Jupiter, converts the quote into a USD price for one share, and
 * compares that against the Pyth reference for the underlying. The printout is
 * the evidence; the point is that the guard runs on real routes and reports
 * honestly when it cannot run at all.
 *
 * Three outcomes, and the whole design is in keeping them apart:
 *
 *   ok          the venue tracks the reference. Route.
 *   dislocated  the venue is priced against something else. Refuse.
 *   unchecked   there is no reference to check against. Refuse, and say so.
 *
 * ## Running two issuers is the point, not a flourish
 *
 * On 2026-09-20 the same underlying produced NVDAx at $222.08 through Riptide
 * and NVDAon at $1,466.42 through Manifest. Both are listed. Both are Token-2022.
 * Both route. Only one is a price. A surface that showed "NVDA — $222.08" from
 * one issuer and "NVDA — $1,466.42" from another, with nothing to say which was
 * which, would be worse than showing neither.
 *
 * ## After hours the reference is Friday's close, and that is fine
 *
 * Pyth's equity feeds stop when the market does. Run this on a weekend and every
 * reference is 40-plus hours old — and every venue still tracks it to within
 * tens of basis points. "Stale" and "shut" are different states here, and
 * conflating them would refuse every route from Friday's close to Monday's open.
 *
 * Exits non-zero only when the guard could not be *evaluated* for anything. A
 * dislocation is a finding, not a failure, and a script that exits 1 whenever
 * the market is interesting is a script nobody runs.
 */

import { checkDeviation, impliedPrice } from "../lib/server/deviation";
import { describeFreshness, referencePrice } from "../lib/server/pyth-reference";
import { routedEquities, type RoutedEquity } from "../lib/server/routed-equities";

/** Small enough that price impact does not masquerade as a dislocation. */
const PROBE_USD = 100;

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;
const QUOTE_URL = process.env.JUPITER_QUOTE_URL ?? "https://lite-api.jup.ag/swap/v1/quote";

function usd(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

type JupiterQuote = {
  outAmount?: string;
  priceImpactPct?: string;
  routePlan?: Array<{ swapInfo?: { label?: string } }>;
  error?: string;
};

type Quote = { units: number; venues: string[]; priceImpactPct: number | null };

/**
 * A live quote for a fixed dollar amount.
 *
 * `priceImpactPct` is passed through as a fraction. That field was left
 * deliberately unused when `quote.ts` was written because its scale had not been
 * verified; it is verified now, by cross-checking against the output amount. A
 * Manifest route that returns 0.68 of a share for $1,000 reports 0.849, i.e.
 * 84.9% — which is what the arithmetic says too. It is display-only here and
 * nothing computes with it.
 */
async function quoteTo(equity: RoutedEquity): Promise<Quote> {
  const amount = BigInt(PROBE_USD) * BigInt(10 ** USDC_DECIMALS);
  const url =
    `${QUOTE_URL}?inputMint=${USDC}&outputMint=${equity.mint}` +
    `&amount=${amount}&slippageBps=50&swapMode=ExactIn`;

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Jupiter returned ${response.status}`);

  const body = (await response.json()) as JupiterQuote;
  if (body.error || typeof body.outAmount !== "string") {
    throw new Error(body.error ?? "quote carried no outAmount");
  }

  // Decimals come from the registry, which validated them against the issuer.
  // xStocks carry 8 and Ondo carries 9, so a shared constant here would report
  // every Ondo price a factor of ten wrong — and it would look entirely
  // plausible, which is the failure this app has already made once.
  const venues = (body.routePlan ?? [])
    .map((leg) => leg.swapInfo?.label)
    .filter((label): label is string => typeof label === "string");

  const impact = Number(body.priceImpactPct);

  return {
    units: Number(body.outAmount) / 10 ** equity.decimals,
    venues,
    priceImpactPct: Number.isFinite(impact) ? impact : null
  };
}

async function referenceFor(symbol: string) {
  try {
    return await referencePrice(symbol);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const { equities, failures } = await routedEquities();

  console.log(`deviation guard · ${usd(PROBE_USD)} probes · reference: Pyth\n`);

  let checked = 0;
  let dislocated = 0;
  let unchecked = 0;
  let unpriced = 0;

  let currentSymbol = "";

  for (const equity of equities) {
    if (equity.symbol !== currentSymbol) {
      currentSymbol = equity.symbol;
      // Read once per underlying and shown in the heading, because both issuers
      // are claims on the same share and printing the reference twice would
      // imply they were not.
      const heading = equities.find((candidate) => candidate.symbol === currentSymbol);
      const reference = await referenceFor(currentSymbol);
      console.log(
        `\n${currentSymbol}` +
          (reference ? `  ·  reference ${usd(reference.price)} — ${describeFreshness(reference.freshness)}` : "") +
          (heading ? "" : "")
      );
    }

    let quote: Quote;
    try {
      quote = await quoteTo(equity);
    } catch (error) {
      unpriced += 1;
      console.log(
        `  ${pad(equity.issuer, 7)} ${pad(equity.tokenSymbol, 9)} NO ROUTE — ` +
          `${error instanceof Error ? error.message : error}`
      );
      continue;
    }

    const price = impliedPrice(PROBE_USD, quote.units);
    const check = await checkDeviation({ symbol: equity.symbol, impliedPrice: price });

    if (check.verdict === "unchecked") unchecked += 1;
    else checked += 1;
    if (check.verdict === "dislocated") dislocated += 1;

    const label =
      check.verdict === "ok" ? "ok" : check.verdict === "dislocated" ? "DISLOCATED" : "UNCHECKED";
    const dev =
      check.deviationBps === null
        ? "—"
        : `${check.deviationBps >= 0 ? "+" : ""}${check.deviationBps.toFixed(0)}bps`;

    console.log(
      `  ${pad(equity.issuer, 7)} ${pad(equity.tokenSymbol, 9)} ${pad(label, 12)}` +
        `${pad(usd(price), 12)} vs ${pad(check.reference ? usd(check.reference.price) : "—", 12)}` +
        `${pad(dev, 10)} ${quote.venues.join(" → ")}`
    );
    if (quote.priceImpactPct !== null && quote.priceImpactPct > 0.01) {
      console.log(`${" ".repeat(20)}price impact ${(quote.priceImpactPct * 100).toFixed(2)}% — this pool is not deep`);
    }
    if (check.verdict !== "ok") {
      console.log(`${" ".repeat(20)}${check.reason}`);
    }
  }

  for (const failure of failures) {
    console.log(`  ${failure.label} NOT PINNED — ${failure.reason}`);
  }

  console.log(
    `\n${checked} checked against a Pyth reference` +
      `${dislocated > 0 ? `, ${dislocated} dislocated` : ""}` +
      `${unchecked > 0 ? `, ${unchecked} unchecked` : ""}` +
      `${unpriced > 0 ? `, ${unpriced} unroutable` : ""}`
  );
  console.log("A dislocation is a finding, not a failure — this exits non-zero only when nothing could be checked.");

  if (checked === 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
