/**
 * Print a wallet's PreStocks positions, priced through the scaled-amount
 * multiplier.
 *
 * Run: `pnpm positions <WALLET>`
 *
 * The point of this script is the raw-vs-scaled column. SpaceX carries a ×5
 * multiplier, so a wallet holding 3.99999673 raw tokens holds 19.99998365 scaled
 * ones — and a portfolio that prices the raw figure against the API's per-scaled
 * price understates the position by 80%. Nothing throws. The number just comes
 * out wrong, and this is the only way to see it happen on real holdings.
 *
 * Exits non-zero when a mint could not be read, but *not* when the wallet simply
 * holds nothing — an empty wallet is a correct answer and a failed read is not,
 * and a script that conflates them teaches the wrong lesson about the empty
 * state.
 */

import { describeError } from "../lib/server/describe-error";
import { describeMultiplier, prestocksPositions } from "../lib/server/prestocks-positions";

function usd(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

async function main(): Promise<void> {
  const wallet = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  if (!wallet) throw new Error("usage: pnpm positions <WALLET>");

  const result = await prestocksPositions(wallet);

  console.log(`${result.wallet}\n`);

  if (result.empty) {
    if (!result.onCurve) {
      console.log("This address is program-derived, not a wallet.");
      console.log(
        "A PDA holds its tokens in a vault rather than in an associated token\n" +
          "account, and this is an ATA scan — so it would miss them. Reported as\n" +
          "'not a wallet' rather than 'holds nothing', because we have not checked."
      );
      return;
    }
    console.log("No PreStocks positions. All eight mints were read; this wallet holds none.");
    console.log(
      "Expected for an app wallet: these tokens are mainnet, so an address that is\n" +
        "active on devnet still holds nothing here."
    );
    return;
  }

  for (const position of result.positions) {
    console.log(
      `${pad(position.symbol, 11)}${usd(position.valueUsd).padStart(14)}  ` +
        `(${usd(position.exitValueUsd)} if sold, ${(position.exitCostFraction * 100).toFixed(2)}% fee)`
    );
    console.log(
      `${" ".repeat(11)}raw ${position.rawTokens.toLocaleString(undefined, {
        maximumFractionDigits: 9
      })} tokens → scaled ${position.scaledAmount.toLocaleString(undefined, {
        maximumFractionDigits: 9
      })}  ${describeMultiplier(position.multiplier)}`
    );

    // The trap, stated as a number rather than a warning. A ×1 multiplier means
    // this line is a no-op; anything else means a naive portfolio is wrong.
    if (position.multiplier.multiplier !== 1) {
      const naive = position.rawTokens * position.tokenPrice;
      console.log(
        `${" ".repeat(11)}!! pricing raw instead of scaled would report ${usd(naive)} — ` +
          `out by ${usd(position.valueUsd - naive)}`
      );
    }
    if (position.multiplier.disagreement) {
      console.log(
        `${" ".repeat(11)}!! multiplier disagreement: measured ` +
          `${position.multiplier.disagreement.measured} vs config ` +
          `${position.multiplier.disagreement.config}`
      );
    }
    if (position.issuerControls) {
      console.log(`${" ".repeat(11)}issuer can seize, freeze or halt this token`);
    }
  }

  if (result.errors.length > 0) {
    console.log();
    for (const error of result.errors) {
      console.log(`${pad(error.symbol, 11)}UNPRICED — ${error.reason}`);
    }
  }

  console.log();
  console.log(`value ${usd(result.totalValueUsd)}   if sold ${usd(result.totalExitValueUsd)}`);
  console.log(
    `the difference is the transfer fee on the way out — ` +
      `${usd(result.totalValueUsd - result.totalExitValueUsd)}`
  );

  if (result.errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  // `describeError`, not `error.message`: some dependency error classes carry an
  // empty message and would print a blank line here. See `describe-error.ts`.
  console.error(describeError(error));
  process.exitCode = 1;
});
