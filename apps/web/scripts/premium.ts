/**
 * Print the pre-IPO dislocation surface.
 *
 * Run: `pnpm premium` (add `-- SYMBOL` to price one token)
 *
 * This is the product claim, rendered. The interesting number is not the premium
 * — anyone can print `tokenPrice / markPrice` — it is how much of that premium
 * survives the transfer fee you pay entering and the one you pay leaving. On the
 * day this was written the round trip was 1%, rising to 2% at epoch 1039, and
 * that is enough to make most of the market untouchable.
 *
 * So the output leads with the count that *isn't* actionable. A surface that only
 * announces opportunities is advertising; the number that makes it a measurement
 * is how much of the market is noise.
 *
 * Exits non-zero if any token could not be priced, so it can gate a deploy. That
 * is a stricter bar than the module's — `premiumSurface` tolerates a single bad
 * mint and reports it, but a script whose whole job is to show the market should
 * not quietly show seven eighths of it.
 */

import { describeError } from "../lib/server/describe-error";
import { actionable, premiumSurface, summarize, type PremiumRow } from "../lib/server/premium";

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

/**
 * How a row reads at a glance, without implying a capability this app lacks.
 *
 * A premium is a real fact about the market and is labelled as one; it is
 * deliberately not labelled an opportunity, because being long-only means this
 * app cannot act on it.
 */
function verdict(row: PremiumRow): string {
  if (row.actionableLong) return "discount clears costs";
  if (row.direction === "premium") return "premium — not tradeable long-only";
  if (row.direction === "par") return "at the mark";
  return "discount, inside the round trip";
}

async function main(): Promise<void> {
  const only = process.argv
    .slice(2)
    .find((arg) => !arg.startsWith("-"))
    ?.toUpperCase();

  const surface = await premiumSurface();
  const rows = only ? surface.rows.filter((row) => row.symbol === only) : surface.rows;
  if (rows.length === 0) throw new Error(`no token matching ${only}`);

  console.log(summarize(surface));
  console.log();

  for (const row of rows) {
    console.log(
      `${pad(row.symbol, 11)}${pad(verdict(row), 36)}` +
        `gross ${signed(row.grossPremium).padStart(8)}  ` +
        `fee ${(row.feeBps / 100).toFixed(2).padStart(5)}%  ` +
        `net edge ${signed(row.netDislocation).padStart(8)}`
    );

    const reconcile = row.multiplier;
    console.log(
      `${" ".repeat(11)}mark $${row.markPrice.toFixed(4)}  ` +
        `token $${row.tokenPrice.toFixed(4)}  ` +
        `×${reconcile.multiplier.toFixed(7)} (${reconcile.source})` +
        `${row.issuerControls ? "  issuer can seize/freeze/halt" : ""}`
    );

    if (reconcile.disagreement) {
      console.log(
        `${" ".repeat(11)}!! multiplier disagreement: measured ` +
          `${reconcile.disagreement.measured} vs config ${reconcile.disagreement.config} — ` +
          `every held balance is priced against a stale belief`
      );
    }
  }

  if (surface.errors.length > 0) {
    console.log();
    for (const error of surface.errors) {
      console.log(`${pad(error.symbol, 11)}UNPRICED — ${error.reason}`);
    }
  }

  console.log();
  const live = actionable(surface.rows);
  if (live.length === 0) {
    console.log("Nothing on this market clears its own round trip. That is the finding.");
  } else {
    console.log(`Actionable: ${live.map((row) => row.symbol).join(", ")}`);
    console.log("A discount is not an arbitrage — the mark is a reference, not a bid.");
  }

  if (surface.errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  // `describeError`, not `error.message`: some dependency error classes carry an
  // empty message and would print a blank line here. See `describe-error.ts`.
  console.error(describeError(error));
  process.exitCode = 1;
});
