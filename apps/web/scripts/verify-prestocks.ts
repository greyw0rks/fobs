/**
 * Check the PreStocks adapter and the Token-2022 policy reader against mainnet.
 *
 * Run: `pnpm tsx scripts/verify-prestocks.ts`
 *
 * This exists because both modules encode facts that were measured once and
 * would otherwise rot silently. Each row asserts something specific:
 *
 *   the API still lists the token, and still prices it
 *   the mint is still Token-2022 on mainnet
 *   the multiplier measured from the API's scaled supply still agrees with the
 *     one derived from the mint's own config — a drift means every held balance
 *     in the app is priced against a stale belief
 *   the fee printed is the one for the *current* epoch, which is the whole point
 *     of not hardcoding it
 *
 * Exits non-zero if any token fails, so it can gate a deploy.
 */

import { fetchPreStocks } from "../lib/server/prestocks";
import {
  effectiveMultiplier,
  feeBpsForEpoch,
  issuerCanActUnilaterally,
  readMintPolicy,
  reconcileMultiplier,
  toScaledAmount
} from "../lib/server/token2022";

const RPC = process.env.PRESTOCKS_RPC_URL ?? "https://api.mainnet-beta.solana.com";

async function currentEpoch(): Promise<number> {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getEpochInfo" })
  });
  const body = (await response.json()) as { result?: { epoch?: number } };
  const epoch = body.result?.epoch;
  if (typeof epoch !== "number") throw new Error("getEpochInfo returned no epoch");
  return epoch;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

async function main(): Promise<void> {
  const epoch = await currentEpoch();
  const nowSeconds = Math.floor(Date.now() / 1000);
  console.log(`mainnet epoch ${epoch}  (${RPC})\n`);

  const tokens = await fetchPreStocks();
  console.log(`${tokens.length} tokens listed by the API\n`);

  let failures = 0;

  for (const token of tokens) {
    const label = pad(token.symbol, 11);
    try {
      const policy = await readMintPolicy(token.mint);
      const reconciled = reconcileMultiplier(policy, token.supply, nowSeconds);
      const feeBps = feeBpsForEpoch(policy, epoch);

      const rawTokens = Number(policy.rawSupply) / 10 ** policy.decimals;
      const scaled = toScaledAmount(policy.rawSupply, policy, reconciled.multiplier);
      const configMultiplier = effectiveMultiplier(policy, nowSeconds);
      // Basis points to a fraction: 50bps is 0.005, not 0.5. `premium` is a
      // fraction too, so mixing the two units is how a 2.4% premium reads as
      // −97.6%.
      const roundTrip = (feeBps / 10_000) * 2;
      // The same framing `premium.ts` uses: the magnitude of the gap, less what
      // it costs to enter and leave. Reporting the *signed* premium minus the
      // cost instead reads as "more negative is worse", when for a buyer the
      // opposite is true — and the two modules would then appear to disagree
      // about the same token.
      const netEdge = Math.abs(token.premium) - roundTrip;

      console.log(
        `${label} ${reconciled.multiplier.toFixed(7).padStart(12)}×  ` +
          `(${reconciled.source})  fee ${(feeBps / 100).toFixed(2)}%  ` +
          `raw ${rawTokens.toLocaleString(undefined, { maximumFractionDigits: 3 })} → ` +
          `scaled ${scaled.toLocaleString(undefined, { maximumFractionDigits: 3 })}`
      );
      console.log(
        `${" ".repeat(11)} gross ${(token.premium * 100).toFixed(2).padStart(7)}% ` +
          `${token.premium < 0 ? "discount" : "premium "}  ` +
          `net edge ${(netEdge * 100).toFixed(2).padStart(7)}% ` +
          `(after a ${(roundTrip * 100).toFixed(2)}% round trip)  ` +
          `unilateral=${issuerCanActUnilaterally(policy) ? "yes" : "no"}`
      );

      if (reconciled.disagreement) {
        console.log(
          `${" ".repeat(11)} !! multiplier disagreement: measured ` +
            `${reconciled.disagreement.measured} vs config ${reconciled.disagreement.config}`
        );
        failures += 1;
      }

      // The config fallback is what the app uses when the API is unreachable.
      // If it disagrees with what the API implies, that fallback is wrong — and
      // since the runtime interpolates between multipliers, a disagreement is
      // expected mid-ramp rather than alarming. Reported, not fatal.
      if (Math.abs(configMultiplier - reconciled.multiplier) > 0.005) {
        console.log(
          `${" ".repeat(11)} note: config-derived ${configMultiplier} differs from measured ` +
            `${reconciled.multiplier.toFixed(7)} (expected if a change is ramping)`
        );
      }

      if (feeBps !== 0 && policy.transferFee) {
        console.log(
          `${" ".repeat(11)} fee schedule: older ${policy.transferFee.older.basisPoints}bps ` +
            `@${policy.transferFee.older.epoch}, newer ${policy.transferFee.newer.basisPoints}bps ` +
            `@${policy.transferFee.newer.epoch}`
        );
      }
    } catch (error) {
      failures += 1;
      console.log(`${label} FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n${tokens.length - failures}/${tokens.length} ok`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
